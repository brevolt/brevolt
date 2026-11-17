import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type OpenedDatabase } from '../src/db/index.js';
import { SESSION_COOKIE, buildApp, createSession, createClientToken } from '../src/index.js';

let opened: OpenedDatabase;
let app: FastifyInstance;
let dir: string;
let cookie: string;
let csrf: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'brevolt-dash-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<meta name="csrf-token" content="__CSRF__">');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  opened = openDatabase({ path: ':memory:' });
  const session = createSession(opened.db, new Date());
  cookie = `${SESSION_COOKIE}=${session.id}`;
  csrf = session.csrfToken;
  app = buildApp({ db: opened.db, dashboardDir: dir });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  opened.close();
  rmSync(dir, { recursive: true, force: true });
});

const write = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, h = {}) =>
  app.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
    headers: { cookie, 'x-csrf-token': csrf, ...h },
  });

describe('dashboard session on /v1', () => {
  it('lists, creates, edits, undoes, deletes and exports with a session', async () => {
    const created = await write(
      'POST',
      '/v1/contacts',
      { givenName: 'Ada' },
      { 'x-operation-id': 'op1' },
    );
    expect(created.statusCode).toBe(201);
    const { id, version } = created.json<{ id: string; version: number }>();

    const patched = await write(
      'PATCH',
      `/v1/contacts/${id}`,
      { company: 'Analytical' },
      {
        'if-match': String(version),
        'x-operation-id': 'op2',
      },
    );
    expect(patched.statusCode).toBe(200);

    const history = await app.inject({ url: `/v1/contacts/${id}/history`, headers: { cookie } });
    expect(
      history.json<{ history: { operationId: string; actor: string }[] }>().history,
    ).toMatchObject([
      { operationId: 'op2', actor: 'dashboard' },
      { operationId: 'op1', actor: 'dashboard' },
    ]);

    const undo = await write('POST', '/v1/changes/op2/undo');
    expect(undo.statusCode).toBe(200);
    expect(undo.json<{ contact: { company: string | null } }>().contact.company).toBeNull();

    const exported = await app.inject({ url: '/v1/export?format=vcf', headers: { cookie } });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain('Ada');

    const del = await write('DELETE', `/v1/contacts/${id}`);
    expect(del.statusCode).toBe(204);
    const list = await app.inject({ url: '/v1/contacts', headers: { cookie } });
    expect(list.json<{ total: number }>().total).toBe(0);
  });

  it('pages and sorts by name with a total', async () => {
    for (const n of ['Cleo', 'Ada', 'Bea']) await write('POST', '/v1/contacts', { givenName: n });
    const res = await app.inject({
      url: '/v1/contacts?order=name&limit=2&offset=1',
      headers: { cookie },
    });
    const body = res.json<{ total: number; contacts: { givenName: string }[] }>();
    expect(body.total).toBe(3);
    expect(body.contacts.map((c) => c.givenName)).toEqual(['Bea', 'Cleo']);
  });

  it('requires the CSRF token and a same-origin request to write', async () => {
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/v1/contacts',
      payload: {},
      headers: { cookie },
    });
    expect(noCsrf.statusCode).toBe(403);
    const crossSite = await write(
      'POST',
      '/v1/contacts',
      {},
      { origin: 'https://evil.example', host: 'localhost' },
    );
    expect(crossSite.statusCode).toBe(403);
  });

  it('keeps client tokens out of undo and export, and sessions out of bridge routes', async () => {
    const token = createClientToken(opened.db, { name: 'plugin', kind: 'obsidian' }, new Date());
    const bearer = { authorization: `Bearer ${token.token}` };
    expect((await app.inject({ url: '/v1/export?format=json', headers: bearer })).statusCode).toBe(
      403,
    );
    expect((await app.inject({ url: '/v1/bridge/x', headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/v1/contacts' })).statusCode).toBe(401);
  });
});

describe('dashboard static files', () => {
  it('redirects to login without a session', async () => {
    const res = await app.inject({ url: '/contacts/123' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('serves index.html with the CSRF token for any route and the assets', async () => {
    const page = await app.inject({ url: '/contacts/123', headers: { cookie } });
    expect(page.body).toContain(`content="${csrf}"`);
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    const asset = await app.inject({ url: '/assets/app.js', headers: { cookie } });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('javascript');
    expect(
      (await app.inject({ url: '/assets/..%2Findex.html', headers: { cookie } })).statusCode,
    ).toBe(404);
    expect((await app.inject({ url: '/assets/missing.js', headers: { cookie } })).statusCode).toBe(
      404,
    );
  });
});
