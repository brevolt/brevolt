import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asc } from 'drizzle-orm';
import { openDatabase, schema, type OpenedDatabase } from '../src/db/index.js';
import {
  buildApp,
  changeRoutes,
  contactRoutes,
  exportSchema,
  type HubExport,
} from '../src/index.js';

let opened: OpenedDatabase;
let app: FastifyInstance;
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 10, 0, tick++));

beforeEach(async () => {
  opened = openDatabase({ path: ':memory:' });
  tick = 0;
  app = Fastify();
  // Auth is covered in auth.test.ts; these routes are exercised directly.
  await app.register(contactRoutes, { db: opened.db, now: clock });
  await app.register(changeRoutes, { db: opened.db, now: clock });
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
  noteMd: string;
  fields: { kind: string; label: string; value: string }[];
  tags: string[];
  custom: Record<string, string>;
}

const create = async (body: object, op: string) =>
  (
    await app.inject({
      method: 'POST',
      url: '/v1/contacts',
      payload: body,
      headers: { 'x-operation-id': op },
    })
  ).json<View>();
const patch = (id: string, version: number, body: object, op: string) =>
  app.inject({
    method: 'PATCH',
    url: `/v1/contacts/${id}`,
    payload: body,
    headers: { 'if-match': String(version), 'x-operation-id': op },
  });
const get = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/v1/contacts/${id}` })).json<View>();
const undo = (op: string, as?: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/changes/${op}/undo`,
    ...(as ? { headers: { 'x-operation-id': as } } : {}),
  });

const ada = {
  givenName: 'Ada',
  familyNames: 'Lovelace',
  company: 'Analytical',
  noteMd: 'Met at; a "conference", line\nbreak',
  fields: [
    { kind: 'phone', label: 'mobile', value: '600 123 456' },
    { kind: 'email', label: 'work', value: 'ada@example.com' },
    { kind: 'phone', label: 'beach house', value: '+34 911 000 000' },
  ],
  tags: ['math'],
  custom: { nick: 'countess' },
};

describe('undo', () => {
  it('undoes an edit, restoring every changed field, as a new operation', async () => {
    const c = await create(ada, 'op-1');
    await patch(c.id, 1, { company: 'Engine Co', tags: ['math', 'vip'], noteMd: '' }, 'op-2');
    const res = await undo('op-2', 'op-undo');
    expect(res.statusCode).toBe(200);
    const back = await get(c.id);
    expect(back.company).toBe('Analytical');
    expect(back.tags).toEqual(['math']);
    expect(back.noteMd).toBe(ada.noteMd);
    expect(back.version).toBe(3);
    const rows = opened.db.select().from(schema.changeLog).orderBy(asc(schema.changeLog.id)).all();
    expect(
      rows
        .filter((r) => r.operationId === 'op-undo')
        .map((r) => r.field)
        .sort(),
    ).toEqual(['company', 'noteMd', 'tags']);
    // The original operation's rows are untouched (insert-only log).
    expect(rows.filter((r) => r.operationId === 'op-2')).toHaveLength(3);
  });

  it('undoes a creation by soft-deleting the contact', async () => {
    const c = await create(ada, 'op-1');
    expect((await undo('op-1')).statusCode).toBe(200);
    expect((await get(c.id)).deletedAt).not.toBeNull();
  });

  it('undoes a deletion by restoring the contact', async () => {
    const c = await create(ada, 'op-1');
    await app.inject({
      method: 'DELETE',
      url: `/v1/contacts/${c.id}`,
      headers: { 'x-operation-id': 'op-del' },
    });
    expect((await get(c.id)).deletedAt).not.toBeNull();
    expect((await undo('op-del')).statusCode).toBe(200);
    const back = await get(c.id);
    expect(back.deletedAt).toBeNull();
    expect(back.fields).toHaveLength(3);
  });

  it('can undo an undo', async () => {
    const c = await create(ada, 'op-1');
    await patch(c.id, 1, { company: 'Engine Co' }, 'op-2');
    await undo('op-2', 'op-u1');
    expect((await undo('op-u1')).statusCode).toBe(200);
    expect((await get(c.id)).company).toBe('Engine Co');
  });

  it('refuses a second undo of the same operation and edits made since', async () => {
    const c = await create(ada, 'op-1');
    await patch(c.id, 1, { company: 'Engine Co' }, 'op-2');
    await undo('op-2');
    const again = await undo('op-2');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'conflict', fields: ['company'] });

    await patch(c.id, 3, { company: 'Third' }, 'op-3');
    expect((await undo('op-2')).statusCode).toBe(409);
    expect((await undo('op-1')).statusCode).toBe(409); // edited since creation
    expect((await get(c.id)).company).toBe('Third');
  });

  it('returns 404 for unknown operations and 400 for malformed ids', async () => {
    expect((await undo('nope')).statusCode).toBe(404);
    expect((await undo('bad%20id')).statusCode).toBe(400);
  });
});

describe('export', () => {
  it('JSON export round-trips through the schema and omits deleted contacts', async () => {
    const a = await create(ada, 'op-1');
    const b = await create({ givenName: 'Gone' }, 'op-2');
    await app.inject({ method: 'DELETE', url: `/v1/contacts/${b.id}` });
    const res = await app.inject({ method: 'GET', url: '/v1/export?format=json' });
    expect(res.statusCode).toBe(200);
    const parsed = exportSchema.parse(JSON.parse(res.body));
    expect(parsed.contacts.map((c) => c.id)).toEqual([a.id]);
    const exported = parsed.contacts[0] as HubExport['contacts'][number];
    const live = await get(a.id);
    expect(exported).toMatchObject({
      givenName: 'Ada',
      noteMd: ada.noteMd,
      tags: ['math'],
      custom: { nick: 'countess' },
      version: live.version,
    });
    expect(exported.fields.map((f) => f.value)).toEqual(live.fields.map((f) => f.value));
  });

  it('vCard export is well-formed 3.0 with escaping, labels and CRLF folding', async () => {
    await create({ ...ada, noteMd: `${ada.noteMd} ${'x'.repeat(200)} ñ` }, 'op-1');
    const res = await app.inject({ method: 'GET', url: '/v1/export?format=vcf' });
    expect(res.headers['content-type']).toContain('text/vcard');
    const body = res.body;
    expect(body.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true);
    expect(body.endsWith('END:VCARD\r\n')).toBe(true);
    expect(body).toContain('N:Lovelace;Ada;;;\r\n');
    expect(body).toContain('FN:Ada Lovelace\r\n');
    expect(body).toContain('TEL;TYPE=CELL:600 123 456\r\n');
    expect(body).toContain('EMAIL;TYPE=INTERNET,WORK:ada@example.com\r\n');
    expect(body).toContain('item1.TEL:+34 911 000 000\r\nitem1.X-ABLabel:beach house\r\n');
    expect(body).toContain('CATEGORIES:math\r\n');
    const unfolded = body.replace(/\r\n /g, '');
    expect(unfolded).toContain('NOTE:Met at\; a "conference"\\, line\\nbreak');
    for (const line of body.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });

  it('rejects an unknown format', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/export?format=csv' })).statusCode).toBe(
      400,
    );
    expect((await app.inject({ method: 'GET', url: '/v1/export' })).statusCode).toBe(400);
  });
});

describe('healthz', () => {
  it('reports ok without authentication and keeps /v1 protected', async () => {
    const full = buildApp({ db: opened.db, now: () => new Date('2026-02-01T10:00:00Z') });
    const health = await full.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      status: 'ok',
      database: 'ok',
      adapters: {},
      time: '2026-02-01T10:00:00.000Z',
    });
    expect((await full.inject({ method: 'GET', url: '/v1/export?format=json' })).statusCode).toBe(
      401,
    );
    expect((await full.inject({ method: 'GET', url: '/nope' })).statusCode).toBe(404);
    await full.close();
  });

  it('answers 503 when the database is down', async () => {
    const other = openDatabase({ path: ':memory:' });
    const full = buildApp({ db: other.db });
    other.close();
    const res = await full.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'down', database: 'down' });
    await full.close();
  });
});
