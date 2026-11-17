import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { openDatabase, schema, type OpenedDatabase } from '../src/db/index.js';
import { contactRoutes, createClientToken, tokenAuthPlugin } from '../src/index.js';

let opened: OpenedDatabase;
let app: FastifyInstance;
let token: string;
let clientId: string;
const clock = new Date('2026-02-01T10:00:00.000Z');

beforeEach(async () => {
  opened = openDatabase({ path: ':memory:' });
  const created = createClientToken(opened.db, { kind: 'obsidian', name: 'vault' }, clock);
  token = created.token;
  clientId = created.id;
  app = Fastify();
  await app.register(tokenAuthPlugin, { db: opened.db, now: () => clock });
  await app.register(contactRoutes, { db: opened.db, now: () => clock });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  opened.close();
});

interface View {
  id: string;
  version: number;
  givenName: string | null;
  company: string | null;
  deletedAt: string | null;
  fields: { normalized: string }[];
  tags: string[];
  custom: Record<string, string>;
}
interface Listing {
  contacts: View[];
}

interface CallOptions {
  body?: unknown;
  ifMatch?: string;
  auth?: string | null;
  op?: string;
}

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts: CallOptions = {}) =>
  app.inject({
    method,
    url,
    headers: {
      ...(opts.auth === null ? {} : { authorization: `Bearer ${opts.auth ?? token}` }),
      ...(opts.ifMatch ? { 'if-match': opts.ifMatch } : {}),
      ...(opts.op ? { 'x-operation-id': opts.op } : {}),
    },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });

const status = async (p: ReturnType<typeof call>) => (await p).statusCode;

async function createAda() {
  const res = await call('POST', '/v1/contacts', {
    body: {
      givenName: 'Ada',
      familyNames: 'Lovelace',
      company: 'Analytical',
      fields: [
        { kind: 'phone', label: 'mobile', value: '600 123 456' },
        { kind: 'email', label: 'work', value: ' Ada@Example.COM ' },
      ],
      tags: ['math'],
      custom: { nick: 'countess' },
    },
    op: 'op-create',
  });
  return res.json<{ id: string; version: number }>();
}

const logRows = () =>
  opened.db.select().from(schema.changeLog).orderBy(asc(schema.changeLog.id)).all();

describe('happy path', () => {
  it('creates, reads, lists, patches and soft-deletes', async () => {
    const created = await call('POST', '/v1/contacts', {
      body: {
        givenName: 'Ada',
        familyNames: 'Lovelace',
        fields: [
          { kind: 'phone', label: 'mobile', value: '600 123 456' },
          { kind: 'email', label: 'work', value: ' Ada@Example.COM ' },
        ],
        tags: ['math'],
        custom: { nick: 'countess' },
      },
    });
    expect(created.statusCode).toBe(201);
    const c = created.json<View>();
    expect(c.version).toBe(1);
    expect(created.headers.etag).toBe('"1"');
    expect(c.fields[0]).toMatchObject({ normalized: '+34600123456' });
    expect(c.fields[1]).toMatchObject({ normalized: 'ada@example.com' });
    expect(c.tags).toEqual(['math']);
    expect(c.custom).toEqual({ nick: 'countess' });

    const got = await call('GET', `/v1/contacts/${c.id}`);
    expect(got.statusCode).toBe(200);
    expect(got.json<View>().givenName).toBe('Ada');

    expect((await call('GET', '/v1/contacts?q=lovel')).json<Listing>().contacts).toHaveLength(1);
    expect((await call('GET', '/v1/contacts?q=nobody')).json<Listing>().contacts).toHaveLength(0);
    expect((await call('GET', '/v1/contacts?q=34600123')).json<Listing>().contacts).toHaveLength(1);

    const patched = await call('PATCH', `/v1/contacts/${c.id}`, {
      ifMatch: '"1"',
      body: { company: 'Engine Co', tags: ['math', 'vip'] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<View>()).toMatchObject({
      version: 2,
      company: 'Engine Co',
      givenName: 'Ada',
    });
    expect(patched.json<View>().tags).toEqual(['math', 'vip']);

    expect(await status(call('DELETE', `/v1/contacts/${c.id}`, { ifMatch: '2' }))).toBe(204);
    const row = opened.db.select().from(schema.contact).where(eq(schema.contact.id, c.id)).get();
    expect(row?.deletedAt).toBe(clock.toISOString());
    expect(row?.version).toBe(3);
    expect((await call('GET', '/v1/contacts')).json<Listing>().contacts).toHaveLength(0);
    // Sync clients still see the deletion through updatedSince.
    const since = await call('GET', '/v1/contacts?updatedSince=2026-01-01T00:00:00Z');
    expect(since.json<Listing>().contacts[0]?.deletedAt).toBeTruthy();
    expect(await status(call('DELETE', `/v1/contacts/${c.id}`))).toBe(404);
  });
});

describe('change_log', () => {
  it('records actor and operation_id on every write', async () => {
    const c = await createAda();
    const created = logRows();
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((r) => r.actor === `client:${clientId}`)).toBe(true);
    expect(created.every((r) => r.operationId === 'op-create')).toBe(true);
    expect(created.map((r) => r.field)).toEqual(
      expect.arrayContaining(['givenName', 'familyNames', 'company', 'fields', 'tags', 'custom']),
    );

    await call('PATCH', `/v1/contacts/${c.id}`, {
      ifMatch: '1',
      op: 'op-patch',
      body: { company: 'Engine Co', givenName: 'Ada' },
    });
    const patch = logRows().filter((r) => r.operationId === 'op-patch');
    // Unchanged givenName is not logged.
    expect(patch).toHaveLength(1);
    expect(patch[0]).toMatchObject({
      field: 'company',
      before: '"Analytical"',
      after: '"Engine Co"',
      contactId: c.id,
    });

    await call('DELETE', `/v1/contacts/${c.id}`, { op: 'op-del' });
    const del = logRows().filter((r) => r.operationId === 'op-del');
    expect(del.map((r) => r.field)).toEqual(['deletedAt']);
  });

  it('generates an operation_id when none is sent and logs nothing for rejected writes', async () => {
    const c = await createAda();
    const before = logRows().length;
    expect(
      await status(call('PATCH', `/v1/contacts/${c.id}`, { ifMatch: '9', body: { company: 'x' } })),
    ).toBe(412);
    expect(await status(call('PATCH', `/v1/contacts/${c.id}`, { body: { company: 'x' } }))).toBe(
      428,
    );
    expect(logRows()).toHaveLength(before);
    await call('PATCH', `/v1/contacts/${c.id}`, { ifMatch: '1', body: { company: 'y' } });
    expect(logRows().at(-1)?.operationId.length).toBeGreaterThan(10);
  });
});

describe('versioning', () => {
  it('PATCH without If-Match → 428, stale version → 412 with the current one', async () => {
    const c = await createAda();
    expect(await status(call('PATCH', `/v1/contacts/${c.id}`, { body: { company: 'x' } }))).toBe(
      428,
    );
    await call('PATCH', `/v1/contacts/${c.id}`, { ifMatch: '1', body: { company: 'x' } });
    const stale = await call('PATCH', `/v1/contacts/${c.id}`, {
      ifMatch: '1',
      body: { company: 'z' },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ error: 'version_mismatch', currentVersion: 2 });
    expect(stale.headers.etag).toBe('"2"');
    expect(
      await status(
        call('PATCH', `/v1/contacts/${c.id}`, { ifMatch: 'abc', body: { company: 'z' } }),
      ),
    ).toBe(400);
  });

  it('two concurrent PATCH on the same version: one wins, the other gets 412', async () => {
    const c = await createAda();
    const [a, b] = await Promise.all([
      call('PATCH', `/v1/contacts/${c.id}`, { ifMatch: '1', body: { company: 'A' } }),
      call('PATCH', `/v1/contacts/${c.id}`, { ifMatch: '1', body: { company: 'B' } }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 412]);
    const final = (await call('GET', `/v1/contacts/${c.id}`)).json<View>();
    expect(final.version).toBe(2);
    expect(final.company).toBe(a.statusCode === 200 ? 'A' : 'B');
    // Only the winner's change reached the log.
    const companyChanges = logRows().filter(
      (r) => r.field === 'company' && r.after !== '"Analytical"',
    );
    expect(companyChanges).toHaveLength(1);
  });

  it('PATCH or DELETE on a missing contact → 404', async () => {
    const id = '0198a0a0-0000-7000-8000-000000000000';
    expect(
      await status(call('PATCH', `/v1/contacts/${id}`, { ifMatch: '1', body: { company: 'x' } })),
    ).toBe(404);
    expect(await status(call('DELETE', `/v1/contacts/${id}`))).toBe(404);
  });
});

describe('validation', () => {
  it('rejects unknown keys, bad types and empty patches with 400', async () => {
    const c = await createAda();
    const patch = (body: unknown) =>
      status(call('PATCH', `/v1/contacts/${c.id}`, { ifMatch: '1', body }));
    expect(await status(call('POST', '/v1/contacts', { body: { bogus: 1 } }))).toBe(400);
    expect(await status(call('POST', '/v1/contacts', { body: { birthday: 'tomorrow' } }))).toBe(
      400,
    );
    expect(
      await status(
        call('POST', '/v1/contacts', {
          body: { fields: [{ kind: 'fax', label: 'x', value: 'y' }] },
        }),
      ),
    ).toBe(400);
    expect(await patch({})).toBe(400);
    expect(await patch({ id: 'x' })).toBe(400);
    expect(await status(call('GET', '/v1/contacts/not-a-uuid'))).toBe(400);
    expect(await status(call('GET', '/v1/contacts?updatedSince=yesterday'))).toBe(400);
  });
});

describe('auth', () => {
  it('rejects missing/invalid tokens and out-of-scope clients', async () => {
    expect(await status(call('GET', '/v1/contacts', { auth: null }))).toBe(401);
    expect(await status(call('GET', '/v1/contacts', { auth: 'brv_nope' }))).toBe(401);
    const bridge = createClientToken(opened.db, { kind: 'bridge-macos', name: 'mac' }, clock);
    expect(await status(call('GET', '/v1/contacts', { auth: bridge.token }))).toBe(403);
    expect(await status(call('POST', '/v1/contacts', { auth: bridge.token, body: {} }))).toBe(403);
    expect(opened.db.select().from(schema.contact).all()).toHaveLength(0);
  });
});
