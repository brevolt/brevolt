import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bridgePendingResponseSchema, type BridgePendingChange } from '@brevolt/contracts';
import {
  SESSION_COOKIE,
  buildApp,
  ContactService,
  createClientToken,
  createSession,
  openDatabase,
  schema,
  type OpenedDatabase,
} from '../src/index.js';

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 10, 0, 0, tick++));

interface H {
  opened: OpenedDatabase;
  app: FastifyInstance;
  token: string;
  cookie: string;
  csrf: string;
  service: ContactService;
}
let h: H;

beforeEach(async () => {
  tick = 0;
  const opened = openDatabase({ path: ':memory:' });
  const app = buildApp({ db: opened.db, now: clock });
  await app.ready();
  const { token } = createClientToken(opened.db, { kind: 'bridge-macos', name: 'mac' });
  const session = createSession(opened.db, clock());
  h = {
    opened,
    app,
    token,
    cookie: `${SESSION_COOKIE}=${session.id}`,
    csrf: session.csrfToken,
    service: new ContactService(opened.db),
  };
});
afterEach(async () => {
  await h.app.close();
  h.opened.close();
});

const LOCAL = 'LOCAL-1:ABPerson';
const ADA_FIELDS = [{ kind: 'phone' as const, label: 'mobile', value: '+34 600 111 222' }];

async function bridge(op: string, change: object) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/bridge/changes',
    headers: { authorization: `Bearer ${h.token}` },
    payload: { changes: [{ operation_id: op, container_id: 'c1', ...change }] },
  });
  expect(res.statusCode).toBe(200);
  const [first] = res.json<{ results: { outcome: string; contact_id: string | null }[] }>().results;
  if (!first) throw new Error('empty results');
  return first;
}
const upsert = (op: string, localId: string, contact: object) =>
  bridge(op, { local_id: localId, kind: 'upsert', contact });
async function pending(): Promise<BridgePendingChange[]> {
  const res = await h.app.inject({
    method: 'GET',
    url: '/v1/bridge/pending',
    headers: { authorization: `Bearer ${h.token}` },
  });
  return bridgePendingResponseSchema.parse(res.json()).changes;
}
const dash = (method: 'GET' | 'POST', url: string, payload?: object) =>
  h.app.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
    headers: { cookie: h.cookie, 'x-csrf-token': h.csrf },
  });
const ctx = (op: string) => ({ actor: 'dashboard', operationId: op, now: clock() });
const contacts = () => h.opened.db.select().from(schema.contact).all();

/** A linked contact whose `company` was edited on both sides: one pending conflict. */
async function conflictOnCompany(): Promise<{ contactId: string; conflictId: string }> {
  const first = await upsert('op-1', LOCAL, { givenName: 'Ada', company: 'Old', fields: [] });
  const contactId = first.contact_id ?? '';
  const v = h.service.get(contactId);
  h.service.update(contactId, { company: 'Hub Corp' }, v?.version ?? 0, ctx('hub-edit'));
  const second = await upsert('op-2', LOCAL, { givenName: 'Ada', company: 'Mac Corp', fields: [] });
  expect(second.outcome).toBe('conflict');
  const list = (await dash('GET', '/v1/conflicts')).json<{ conflicts: { id: string }[] }>();
  expect(list.conflicts).toHaveLength(1);
  return { contactId, conflictId: list.conflicts[0]?.id ?? '' };
}

describe('access', () => {
  it('only the dashboard decides: client tokens are forbidden', async () => {
    const { conflictId } = await conflictOnCompany();
    const auth = { authorization: `Bearer ${h.token}` };
    for (const [method, url] of [
      ['GET', '/v1/conflicts'],
      ['POST', `/v1/conflicts/${conflictId}/resolve`],
      ['GET', '/v1/proposals'],
    ] as const) {
      expect((await h.app.inject({ method, url, headers: auth })).statusCode).toBe(403);
    }
    expect((await h.app.inject({ method: 'GET', url: '/v1/conflicts' })).statusCode).toBe(401);
  });
});

describe('field conflicts', () => {
  it('writes nothing anywhere until resolved', async () => {
    const { contactId } = await conflictOnCompany();
    expect(h.service.get(contactId)?.company).toBe('Hub Corp');
    expect(await pending()).toEqual([]);
  });

  it('resolves with the hub value and pushes it to the external system', async () => {
    const { contactId, conflictId } = await conflictOnCompany();
    const res = await dash('POST', `/v1/conflicts/${conflictId}/resolve`, { resolution: 'hub' });
    expect(res.statusCode).toBe(200);
    expect(h.service.get(contactId)?.company).toBe('Hub Corp');
    const changes = await pending();
    expect(changes).toHaveLength(1);
    expect(changes[0]?.contact?.company).toBe('Hub Corp');
    const row = h.opened.db.select().from(schema.conflict).get();
    expect(row).toMatchObject({ status: 'resolved', resolution: 'hub' });
  });

  it('resolves with the external value: hub takes it and nothing echoes back', async () => {
    const { contactId, conflictId } = await conflictOnCompany();
    const res = await dash('POST', `/v1/conflicts/${conflictId}/resolve`, {
      resolution: 'external',
    });
    expect(res.statusCode).toBe(200);
    expect(h.service.get(contactId)?.company).toBe('Mac Corp');
    expect(await pending()).toEqual([]);
  });

  it('resolves with a manual value written to the hub and pushed out', async () => {
    const { contactId, conflictId } = await conflictOnCompany();
    const res = await dash('POST', `/v1/conflicts/${conflictId}/resolve`, {
      resolution: 'manual',
      value: 'Manual Corp',
    });
    expect(res.statusCode).toBe(200);
    expect(h.service.get(contactId)?.company).toBe('Manual Corp');
    expect((await pending())[0]?.contact?.company).toBe('Manual Corp');
  });

  it('rejects invalid manual values, unknown ids and double resolution', async () => {
    const { conflictId } = await conflictOnCompany();
    const url = `/v1/conflicts/${conflictId}/resolve`;
    expect((await dash('POST', url, { resolution: 'manual', value: 42 })).statusCode).toBe(400);
    expect((await dash('POST', url, { resolution: 'nope' })).statusCode).toBe(400);
    const missing = '/v1/conflicts/01900000-0000-7000-8000-000000000009/resolve';
    expect((await dash('POST', missing, { resolution: 'hub' })).statusCode).toBe(404);
    expect((await dash('POST', url, { resolution: 'hub' })).statusCode).toBe(200);
    expect((await dash('POST', url, { resolution: 'hub' })).statusCode).toBe(409);
  });

  it('resolves a conflict on a list entry (label) with a manual value', async () => {
    const first = await upsert('op-1', LOCAL, { givenName: 'Ada', fields: ADA_FIELDS });
    const id = first.contact_id ?? '';
    const v = h.service.get(id);
    h.service.update(
      id,
      { fields: [{ kind: 'phone', label: 'work', value: '+34 600 111 222' }] },
      v?.version ?? 0,
      ctx('hub-edit'),
    );
    const second = await upsert('op-2', LOCAL, {
      givenName: 'Ada',
      fields: [{ kind: 'phone', label: 'home', value: '+34 600 111 222' }],
    });
    expect(second.outcome).toBe('conflict');
    const { conflicts } = (await dash('GET', '/v1/conflicts')).json<{
      conflicts: { id: string; field: string }[];
    }>();
    expect(conflicts[0]?.field).toMatch(/^fields:phone:/);
    const res = await dash('POST', `/v1/conflicts/${conflicts[0]?.id ?? ''}/resolve`, {
      resolution: 'manual',
      value: { label: 'other', value: '+34 600 111 222' },
    });
    expect(res.statusCode).toBe(200);
    expect(h.service.get(id)?.fields[0]?.label).toBe('other');
    expect((await pending())[0]?.contact?.fields[0]?.label).toBe('other');
  });
});

describe('deleted-upstream', () => {
  async function deletedUpstream() {
    const first = await upsert('op-1', LOCAL, { givenName: 'Ada', fields: [] });
    const contactId = first.contact_id ?? '';
    const res = await bridge('op-2', { local_id: LOCAL, kind: 'delete' });
    expect(res.outcome).toBe('deleted_upstream');
    const { proposals } = (await dash('GET', '/v1/proposals')).json<{
      proposals: { id: string; type: string }[];
    }>();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.type).toBe('deleted-upstream');
    return { contactId, proposalId: proposals[0]?.id ?? '' };
  }

  it('waits for confirmation and writes nothing meanwhile', async () => {
    const { contactId } = await deletedUpstream();
    expect(h.service.get(contactId)?.deletedAt).toBeNull();
    expect(await pending()).toEqual([]);
    // Resending the delete does not duplicate the proposal.
    await bridge('op-3', { local_id: LOCAL, kind: 'delete' });
    expect(h.opened.db.select().from(schema.proposal).all()).toHaveLength(1);
  });

  it('accepting soft-deletes the contact and leaves nothing to push back', async () => {
    const { contactId, proposalId } = await deletedUpstream();
    const res = await dash('POST', `/v1/proposals/${proposalId}/accept`);
    expect(res.statusCode).toBe(200);
    expect(h.service.get(contactId)?.deletedAt).not.toBeNull();
    expect(await pending()).toEqual([]);
    const links = h.opened.db
      .select()
      .from(schema.externalLink)
      .where(eq(schema.externalLink.contactId, contactId))
      .all();
    expect(links).toHaveLength(0);
    expect((await dash('POST', `/v1/proposals/${proposalId}/accept`)).statusCode).toBe(409);
  });

  it('rejecting keeps the contact and recreates it in the external system', async () => {
    const { contactId, proposalId } = await deletedUpstream();
    const res = await dash('POST', `/v1/proposals/${proposalId}/reject`);
    expect(res.statusCode).toBe(200);
    expect(h.service.get(contactId)?.deletedAt).toBeNull();
    const changes = await pending();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'upsert', contact_id: contactId });
    expect(changes[0]?.local_id ?? null).toBeNull();
  });

  it('is withdrawn when the contact reappears externally', async () => {
    const { proposalId } = await deletedUpstream();
    await upsert('op-3', LOCAL, { givenName: 'Ada', fields: [] });
    const row = h.opened.db
      .select()
      .from(schema.proposal)
      .where(eq(schema.proposal.id, proposalId))
      .get();
    expect(row?.status).toBe('withdrawn');
  });
});

describe('merge proposals', () => {
  async function duplicate() {
    const existing = h.service.create(
      { givenName: 'Ada', company: 'Hub Corp', fields: ADA_FIELDS },
      ctx('hub-create'),
    );
    const res = await upsert('op-1', LOCAL, {
      givenName: 'Ada',
      company: 'Mac Corp',
      fields: [...ADA_FIELDS, { kind: 'email', label: 'work', value: 'ADA@example.com' }],
    });
    expect(res.outcome).toBe('proposal');
    expect(res.contact_id).toBe(existing.id);
    const { proposals } = (await dash('GET', '/v1/proposals')).json<{
      proposals: { id: string; type: string; reason: string }[];
    }>();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ type: 'merge', reason: 'phone:+34600111222' });
    return { existingId: existing.id, proposalId: proposals[0]?.id ?? '' };
  }

  it('never merges automatically: no new contact, nothing written', async () => {
    const { existingId } = await duplicate();
    expect(contacts()).toHaveLength(1);
    expect(h.service.get(existingId)?.fields).toHaveLength(1);
    expect(await pending()).toEqual([]);
  });

  it('accepting links the record and merges; differing values become conflicts', async () => {
    const { existingId, proposalId } = await duplicate();
    const res = await dash('POST', `/v1/proposals/${proposalId}/accept`);
    expect(res.statusCode).toBe(200);
    expect(contacts()).toHaveLength(1);
    const view = h.service.get(existingId);
    expect(view?.fields.map((f) => f.normalized).sort()).toEqual([
      '+34600111222',
      'ada@example.com',
    ]);
    expect(view?.company).toBe('Hub Corp');
    const open = h.opened.db
      .select()
      .from(schema.conflict)
      .where(and(eq(schema.conflict.contactId, existingId), eq(schema.conflict.status, 'pending')))
      .all();
    expect(open.map((c) => c.field)).toEqual(['company']);
  });

  it('rejecting creates a separate linked contact', async () => {
    const { existingId, proposalId } = await duplicate();
    const res = await dash('POST', `/v1/proposals/${proposalId}/reject`);
    expect(res.statusCode).toBe(200);
    expect(contacts()).toHaveLength(2);
    expect(h.service.get(existingId)?.company).toBe('Hub Corp');
    const links = h.opened.db.select().from(schema.externalLink).all();
    expect(links).toHaveLength(1);
    expect(links[0]?.externalId).toBe(LOCAL);
    expect(links[0]?.contactId).not.toBe(existingId);
  });

  it('is withdrawn if the external record is deleted before a decision', async () => {
    await duplicate();
    const res = await bridge('op-2', { local_id: LOCAL, kind: 'delete' });
    expect(res.outcome).toBe('ignored');
    const body = (await dash('GET', '/v1/proposals')).json<{ proposals: unknown[] }>();
    expect(body.proposals).toEqual([]);
  });
});
