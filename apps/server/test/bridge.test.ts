import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  bridgeAckResponseSchema,
  bridgeChangesRequestSchema,
  bridgeChangesResponseSchema,
  bridgePendingResponseSchema,
  type BridgeChangesRequest,
  type BridgePendingChange,
} from '@brevolt/contracts';
import {
  buildApp,
  ContactService,
  createClientToken,
  openDatabase,
  schema,
  type OpenedDatabase,
} from '../src/index.js';
import { MAX_ATTEMPTS } from '../src/bridge/sync.js';
import { setDryRun } from '../src/settings/dry-run.js';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../packages/contracts/fixtures/bridge/${name}`, import.meta.url),
      'utf8',
    ),
  );

interface Harness {
  opened: OpenedDatabase;
  app: FastifyInstance;
  token: string;
  clientId: string;
  service: ContactService;
}

const sharedBatch = (): BridgeChangesRequest =>
  bridgeChangesRequestSchema.parse(fixture('changes-upsert.json'));
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 10, 0, 0, tick++));
let h: Harness;

async function harness(): Promise<Harness> {
  const opened = openDatabase({ path: ':memory:' });
  const app = buildApp({ db: opened.db, now: clock });
  await app.ready();
  const { token, id } = createClientToken(opened.db, { kind: 'bridge-macos', name: 'mac' });
  // Dry-run is on by default (BRV-033); these tests exercise real sync.
  setDryRun(opened.db, 'icloud', false);
  return { opened, app, token, clientId: id, service: new ContactService(opened.db) };
}

const auth = (x: Harness) => ({ authorization: `Bearer ${x.token}` });

async function post(x: Harness, url: string, payload: unknown) {
  const res = await x.app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: auth(x),
  });
  return { status: res.statusCode, body: res.json<unknown>() };
}
async function pending(x: Harness, cursor?: string) {
  const res = await x.app.inject({
    method: 'GET',
    url: `/v1/bridge/pending${cursor ? `?cursor=${cursor}` : ''}`,
    headers: auth(x),
  });
  expect(res.statusCode).toBe(200);
  return bridgePendingResponseSchema.parse(res.json());
}
const upsert = (op: string, localId: string, contact: object): BridgeChangesRequest => ({
  changes: [
    { operation_id: op, local_id: localId, container_id: 'c1', kind: 'upsert', contact },
  ] as BridgeChangesRequest['changes'],
});
const ackOk = (p: BridgePendingChange, localId?: string) => ({
  operation_id: p.operation_id,
  status: 'ok' as const,
  ...(localId ? { local_id: localId } : {}),
});
const logCount = (x: Harness) => x.opened.db.select().from(schema.changeLog).all().length;
const contacts = (x: Harness) => x.opened.db.select().from(schema.contact).all();
const ctx = (op: string) => ({ actor: 'dashboard', operationId: op, now: clock() });

beforeEach(async () => {
  tick = 0;
  h = await harness();
});
afterEach(async () => {
  await h.app.close();
  h.opened.close();
});

describe('contract fixtures', () => {
  it('accepts the shared batch and answers with the contract shape', async () => {
    const res = await post(h, '/v1/bridge/changes', fixture('changes-upsert.json'));
    expect(res.status).toBe(200);
    const parsed = bridgeChangesResponseSchema.parse(res.body);
    expect(parsed.results.map((r) => r.outcome)).toEqual(['created', 'ignored']);
  });

  it('accepts the shared ack shape and answers with the contract shape', async () => {
    const res = await post(h, '/v1/bridge/ack', fixture('ack-request.json'));
    expect(res.status).toBe(200);
    const parsed = bridgeAckResponseSchema.parse(res.body);
    expect(parsed.results.every((r) => r.result === 'unknown')).toBe(true);
  });

  it('rejects invalid bodies with 400 and requires a bridge token', async () => {
    expect((await post(h, '/v1/bridge/changes', { changes: [{ kind: 'upsert' }] })).status).toBe(
      400,
    );
    const anon = await h.app.inject({ method: 'GET', url: '/v1/bridge/pending' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('POST /v1/bridge/changes', () => {
  it('resending the same batch with the same operation_id changes nothing', async () => {
    const batch = sharedBatch();
    const first = await post(h, '/v1/bridge/changes', batch);
    const logs = logCount(h);
    const second = await post(h, '/v1/bridge/changes', batch);
    expect(contacts(h)).toHaveLength(1);
    expect(logCount(h)).toBe(logs);
    expect(bridgeChangesResponseSchema.parse(second.body).results.map((r) => r.outcome)).toEqual([
      'duplicate',
      'duplicate',
    ]);
    expect(bridgeChangesResponseSchema.parse(first.body).results[0]?.contact_id).toBe(
      bridgeChangesResponseSchema.parse(second.body).results[0]?.contact_id,
    );
  });

  it('normalizes incoming values and links the contact to its Contacts id', async () => {
    await post(h, '/v1/bridge/changes', fixture('changes-upsert.json'));
    const [c] = contacts(h);
    const fields = h.opened.db.select().from(schema.contactField).all();
    expect(fields.map((f) => f.normalized).sort()).toEqual(['+34600111222', 'ada@example.com']);
    const link = h.opened.db.select().from(schema.externalLink).get();
    expect(link).toMatchObject({ contactId: c?.id, system: 'icloud' });
  });

  it('merges a full snapshot exactly like an incremental batch', async () => {
    const other = await harness();
    try {
      const batch = sharedBatch();
      const edit = upsert('mac-0003', batch.changes[0]?.local_id ?? '', {
        givenName: 'Ada',
        familyNames: 'Lovelace',
        company: 'Babbage & Co',
        fields: [{ kind: 'phone', label: 'mobile', value: '+34600111222' }],
      });
      await post(h, '/v1/bridge/changes', batch);
      await post(h, '/v1/bridge/changes', edit);
      await post(other, '/v1/bridge/changes', { ...batch, snapshot: true });
      await post(other, '/v1/bridge/changes', { ...edit, snapshot: true });
      const view = (x: Harness) => {
        const c = contacts(x)[0];
        return c ? x.service.get(c.id) : null;
      };
      const strip = (v: ReturnType<typeof view>) =>
        v && {
          ...v,
          id: 0,
          createdAt: 0,
          updatedAt: 0,
          fields: v.fields.map((f) => [f.kind, f.normalized]),
        };
      expect(strip(view(other))).toEqual(strip(view(h)));
      expect(view(h)?.company).toBe('Babbage & Co');
    } finally {
      await other.app.close();
      other.opened.close();
    }
  });

  it('flags an upstream delete without deleting in the hub', async () => {
    const batch = sharedBatch();
    await post(h, '/v1/bridge/changes', batch);
    const res = await post(h, '/v1/bridge/changes', {
      changes: [
        {
          operation_id: 'mac-del',
          local_id: batch.changes[0]?.local_id,
          container_id: 'c1',
          kind: 'delete',
        },
      ],
    });
    expect(bridgeChangesResponseSchema.parse(res.body).results[0]?.outcome).toBe(
      'deleted_upstream',
    );
    expect(contacts(h)[0]?.deletedAt).toBeNull();
  });

  it('never writes a conflicting field anywhere and records the conflict', async () => {
    const batch = sharedBatch();
    const local = batch.changes[0]?.local_id ?? '';
    await post(h, '/v1/bridge/changes', batch);
    const id = contacts(h)[0]?.id ?? '';
    const v = h.service.get(id);
    h.service.update(id, { company: 'Hub Corp' }, v?.version ?? 0, ctx('hub-edit'));
    const res = await post(
      h,
      '/v1/bridge/changes',
      upsert('mac-conflict', local, {
        givenName: 'Ada',
        familyNames: 'Lovelace',
        company: 'Mac Corp',
        fields: batch.changes[0]?.contact?.fields ?? [],
      }),
    );
    expect(bridgeChangesResponseSchema.parse(res.body).results[0]?.outcome).toBe('conflict');
    expect(h.service.get(id)?.company).toBe('Hub Corp');
    const conflicts = h.opened.db.select().from(schema.conflict).all();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ field: 'company', status: 'pending' });
    expect((await pending(h)).changes).toEqual([]);
  });
});

describe('GET /v1/bridge/pending and POST /v1/bridge/ack', () => {
  it('never returns the client its own changes', async () => {
    await post(h, '/v1/bridge/changes', fixture('changes-upsert.json'));
    expect((await pending(h)).changes).toEqual([]);
  });

  it('delivers a hub-created contact and, after the ack, base and link are updated together', async () => {
    const created = h.service.create(
      {
        givenName: 'Grace',
        familyNames: 'Hopper',
        fields: [{ kind: 'email', label: 'work', value: 'Grace@Example.com' }],
      },
      ctx('dash-1'),
    );
    const page = await pending(h);
    expect(page.changes).toHaveLength(1);
    const change = page.changes[0];
    expect(change).toMatchObject({ contact_id: created.id, local_id: null, kind: 'upsert' });
    expect(change?.contact?.fields[0]?.value).toBe('Grace@Example.com');
    // Nothing is linked until the ack.
    expect(h.opened.db.select().from(schema.syncBase).all()).toHaveLength(0);

    const res = await post(h, '/v1/bridge/ack', {
      acks: [ackOk(change as BridgePendingChange, 'LOCAL-1')],
    });
    expect(bridgeAckResponseSchema.parse(res.body).results[0]?.result).toBe('applied');
    const link = h.opened.db.select().from(schema.externalLink).get();
    const base = h.opened.db.select().from(schema.syncBase).get();
    expect(link).toMatchObject({ contactId: created.id, externalId: 'LOCAL-1', etag: base?.hash });
    expect((await pending(h)).changes).toEqual([]);

    // Re-acking is a no-op.
    const again = await post(h, '/v1/bridge/ack', {
      acks: [ackOk(change as BridgePendingChange, 'LOCAL-1')],
    });
    expect(bridgeAckResponseSchema.parse(again.body).results[0]?.result).toBe('duplicate');
  });

  it('keeps the base untouched on an ack with error and retries, up to a limit', async () => {
    h.service.create({ givenName: 'Linus' }, ctx('dash-2'));
    const first = (await pending(h)).changes[0] as BridgePendingChange;
    const res = await post(h, '/v1/bridge/ack', {
      acks: [{ operation_id: first.operation_id, status: 'error', error: 'save failed' }],
    });
    expect(bridgeAckResponseSchema.parse(res.body).results[0]?.result).toBe('error_recorded');
    expect(h.opened.db.select().from(schema.syncBase).all()).toHaveLength(0);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const retry = (await pending(h)).changes[0];
      expect(retry?.operation_id).toBe(first.operation_id);
      await post(h, '/v1/bridge/ack', {
        acks: [{ operation_id: first.operation_id, status: 'error', error: 'again' }],
      });
    }
    expect((await pending(h)).changes).toEqual([]);
  });

  it('an error in one ack does not block the rest of the batch', async () => {
    h.service.create({ givenName: 'A' }, ctx('d-a'));
    h.service.create({ givenName: 'B' }, ctx('d-b'));
    const [a, b] = (await pending(h)).changes as [BridgePendingChange, BridgePendingChange];
    const res = await post(h, '/v1/bridge/ack', {
      acks: [{ operation_id: a.operation_id, status: 'error', error: 'x' }, ackOk(b, 'LOCAL-B')],
    });
    expect(bridgeAckResponseSchema.parse(res.body).results.map((r) => r.result)).toEqual([
      'error_recorded',
      'applied',
    ]);
  });

  it('rejects a create ack without local_id', async () => {
    h.service.create({ givenName: 'NoId' }, ctx('d-n'));
    const p = (await pending(h)).changes[0] as BridgePendingChange;
    const res = await post(h, '/v1/bridge/ack', { acks: [ackOk(p)] });
    expect(bridgeAckResponseSchema.parse(res.body).results[0]?.result).toBe('rejected');
    expect(h.opened.db.select().from(schema.externalLink).all()).toHaveLength(0);
  });

  it('sends hub edits and hub deletes of linked contacts, and unlinks after the delete ack', async () => {
    const batch = sharedBatch();
    await post(h, '/v1/bridge/changes', batch);
    const id = contacts(h)[0]?.id ?? '';
    h.service.update(id, { jobTitle: 'Countess' }, h.service.get(id)?.version ?? 0, ctx('hub-e'));
    const edit = (await pending(h)).changes[0] as BridgePendingChange;
    expect(edit).toMatchObject({ kind: 'upsert', local_id: batch.changes[0]?.local_id });
    expect(edit.contact?.jobTitle).toBe('Countess');
    await post(h, '/v1/bridge/ack', { acks: [ackOk(edit)] });
    expect((await pending(h)).changes).toEqual([]);

    h.service.remove(id, null, ctx('hub-del'));
    const del = (await pending(h)).changes[0] as BridgePendingChange;
    expect(del.kind).toBe('delete');
    await post(h, '/v1/bridge/ack', { acks: [ackOk(del)] });
    expect(h.opened.db.select().from(schema.externalLink).all()).toHaveLength(0);
    expect((await pending(h)).changes).toEqual([]);
  });

  it('pages with the cursor', async () => {
    for (let i = 0; i < 120; i++)
      h.service.create({ givenName: `P${String(i)}` }, ctx(`d-${String(i)}`));
    const p1 = await pending(h);
    expect(p1.changes).toHaveLength(100);
    expect(p1.next_cursor).not.toBeNull();
    const p2 = await pending(h, p1.next_cursor ?? undefined);
    expect(p2.changes).toHaveLength(20);
    expect(p2.next_cursor).toBeNull();
  });

  it('keeps queues per client', async () => {
    const second = createClientToken(h.opened.db, { kind: 'bridge-macos', name: 'mac2' });
    h.service.create({ givenName: 'Shared' }, ctx('d-s'));
    expect((await pending(h)).changes).toHaveLength(1);
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/bridge/pending',
      headers: { authorization: `Bearer ${second.token}` },
    });
    expect(bridgePendingResponseSchema.parse(res.json()).changes).toHaveLength(1);
  });
});

describe('system: simulated bridge', () => {
  /** A fake Contacts store plus the bridge loop: upload local edits, poll pending, apply, ack. */
  it('does not loop over 100 sync cycles with edits on both sides', async () => {
    const store = new Map<string, object>();
    const dirty = new Set<string>();
    let seq = 0;
    const cycle = async () => {
      const changes = [...dirty].map((localId) => ({
        operation_id: `mac-${String(++seq)}`,
        local_id: localId,
        container_id: 'c1',
        kind: 'upsert' as const,
        contact: store.get(localId),
      }));
      dirty.clear();
      if (changes.length) await post(h, '/v1/bridge/changes', { changes });
      const page = await pending(h);
      const acks = page.changes.map((p) => {
        const localId = p.local_id ?? `LOCAL-${p.contact_id.slice(-6)}`;
        store.set(localId, p.contact ?? {}); // own writes are not re-uploaded (transactionAuthor)
        return ackOk(p, localId);
      });
      if (acks.length) await post(h, '/v1/bridge/ack', { acks });
      return page.changes.length;
    };

    store.set('L0', {
      givenName: 'Seed',
      fields: [{ kind: 'phone', label: 'mobile', value: '+34 611 000 000' }],
    });
    dirty.add('L0');
    await cycle();
    await cycle();
    const base = logCount(h);

    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) {
        // Edit on the "phone" side.
        const cur = store.get('L0') as { givenName: string };
        store.set('L0', { ...cur, jobTitle: `Mac ${String(i)}` });
        dirty.add('L0');
      }
      if (i % 10 === 5) {
        const id = contacts(h)[0]?.id ?? '';
        h.service.update(
          id,
          { company: `Hub ${String(i)}` },
          h.service.get(id)?.version ?? 0,
          ctx(`hub-${String(i)}`),
        );
      }
      await cycle();
    }
    // Settle: nothing left to send either way.
    expect(await cycle()).toBe(0);
    expect(await cycle()).toBe(0);
    expect(contacts(h)).toHaveLength(1);
    expect(h.opened.db.select().from(schema.conflict).all()).toHaveLength(0);
    const final = h.service.get(contacts(h)[0]?.id ?? '');
    expect(final?.jobTitle).toBe('Mac 90');
    expect(final?.company).toBe('Hub 95');
    expect((store.get('L0') as { company: string }).company).toBe('Hub 95');
    // 10 edits per side, each one change_log operation per changed field; no phantom writes.
    expect(logCount(h) - base).toBe(20);
    const stuck = h.opened.db
      .select()
      .from(schema.bridgePending)
      .where(
        and(
          eq(schema.bridgePending.clientId, h.clientId),
          eq(schema.bridgePending.status, 'pending'),
        ),
      )
      .all();
    expect(stuck).toHaveLength(0);
  });
});
