import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, schema, type OpenedDatabase } from '../src/db/index.js';
import {
  CSRF_FIELD,
  LOGIN_CSRF_COOKIE,
  SESSION_COOKIE,
  buildApp,
  ensureAdmin,
  getPhoneRegion,
} from '../src/index.js';

const PASSWORD = 'correct horse battery staple';

let opened: OpenedDatabase;
let app: FastifyInstance;

beforeEach(async () => {
  opened = openDatabase({ path: ':memory:' });
  await ensureAdmin(opened.db, PASSWORD);
  app = buildApp({ db: opened.db }, () => ({ google: 'ok', icloud: 'down' }));
  await app.ready();
});
afterEach(async () => {
  await app.close();
  opened.close();
});

const cookieValue = (res: { headers: Record<string, unknown> }, name: string): string => {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [String(raw)];
  const line = lines.find((l) => l.startsWith(`${name}=`)) ?? '';
  return line.split(';')[0]?.split('=')[1] ?? '';
};

const form = (data: Record<string, string>) => ({
  'content-type': 'application/x-www-form-urlencoded',
  payload: new URLSearchParams(data).toString(),
});

async function loginSession(): Promise<{ cookie: string; csrf: string }> {
  const page = await app.inject({ method: 'GET', url: '/login' });
  const loginCsrf = cookieValue(page, LOGIN_CSRF_COOKIE);
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `${LOGIN_CSRF_COOKIE}=${loginCsrf}`,
    },
    payload: new URLSearchParams({ password: PASSWORD, [CSRF_FIELD]: loginCsrf }).toString(),
  });
  expect(res.statusCode).toBe(303);
  const csrf = opened.db.select().from(schema.adminSession).get()?.csrfToken ?? '';
  return { cookie: `${SESSION_COOKIE}=${cookieValue(res, SESSION_COOKIE)}`, csrf };
}

async function post(
  s: { cookie: string; csrf: string },
  url: string,
  data: Record<string, string>,
) {
  const f = form({ ...data, [CSRF_FIELD]: s.csrf });
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': f['content-type'], cookie: s.cookie },
    payload: f.payload,
  });
}

const tokenIn = (html: string): string =>
  /id="token-value"[^>]*value="([^"]+)"/.exec(html)?.[1] ?? '';

describe('settings page', () => {
  it('requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/settings' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('lists tokens with name, scope and last seen, and systems status', async () => {
    const s = await loginSession();
    await post(s, '/settings/tokens', { name: 'My Mac', kind: 'bridge-macos' });
    const res = await app.inject({
      method: 'GET',
      url: '/settings',
      headers: { cookie: s.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('My Mac');
    expect(res.body).toContain('<td>bridge</td>');
    expect(res.body).toContain('<td>never</td>');
    expect(res.body).toContain('google: ok');
    expect(res.body).toContain('icloud: down');
  });
});

describe('client tokens E2E', () => {
  it('creates a token shown once, uses it against the API, then revokes it', async () => {
    const s = await loginSession();

    const created = await post(s, '/settings/tokens', { name: 'Vault', kind: 'obsidian' });
    expect(created.statusCode).toBe(200);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.body).toContain('id="copy-token"');
    const token = tokenIn(created.body);
    expect(token).toMatch(/^brv_/);

    // Shown once: neither the list nor the database holds the plain value.
    const again = await app.inject({
      method: 'GET',
      url: '/settings',
      headers: { cookie: s.cookie },
    });
    expect(again.body).not.toContain(token);
    expect(JSON.stringify(opened.db.select().from(schema.client).all())).not.toContain(token);

    const api = () =>
      app.inject({
        method: 'GET',
        url: '/v1/contacts',
        headers: { authorization: `Bearer ${token}` },
      });
    expect((await api()).statusCode).toBe(200);
    const seen = await app.inject({
      method: 'GET',
      url: '/settings',
      headers: { cookie: s.cookie },
    });
    expect(seen.body).not.toContain('<td>never</td>');

    const id = opened.db.select().from(schema.client).get()?.id ?? '';
    const revoked = await post(s, `/settings/tokens/${id}/revoke`, {});
    expect(revoked.statusCode).toBe(303);
    expect((await api()).statusCode).toBe(401);
    const list = await app.inject({
      method: 'GET',
      url: '/settings',
      headers: { cookie: s.cookie },
    });
    expect(list.body).toContain('<td>revoked</td>');
  });

  it('rejects creation without CSRF token or with an invalid body', async () => {
    const s = await loginSession();
    const f = form({ name: 'x', kind: 'obsidian' });
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/settings/tokens',
      headers: { 'content-type': f['content-type'], cookie: s.cookie },
      payload: f.payload,
    });
    expect(noCsrf.statusCode).toBe(403);
    expect((await post(s, '/settings/tokens', { name: '', kind: 'obsidian' })).statusCode).toBe(
      400,
    );
    expect((await post(s, '/settings/tokens', { name: 'x', kind: 'admin' })).statusCode).toBe(400);
    expect(opened.db.select().from(schema.client).all()).toHaveLength(0);
  });
});

describe('default phone region', () => {
  it('defaults to ES, saves a valid region and applies it to new phones', async () => {
    const s = await loginSession();
    expect(getPhoneRegion(opened.db)).toBe('ES');
    expect((await post(s, '/settings/region', { region: 'us' })).statusCode).toBe(303);
    expect(getPhoneRegion(opened.db)).toBe('US');

    const created = await post(s, '/settings/tokens', { name: 'c', kind: 'obsidian' });
    const token = tokenIn(created.body);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contacts',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        givenName: 'Test',
        fields: [{ kind: 'phone', label: 'mobile', value: '(415) 555-2671' }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(opened.db.select().from(schema.contactField).get()?.normalized).toBe('+14155552671');
  });

  it('rejects invalid regions', async () => {
    const s = await loginSession();
    for (const region of ['', 'E', 'ESP', 'ZZ', '12']) {
      expect((await post(s, '/settings/region', { region })).statusCode).toBe(400);
    }
    expect(getPhoneRegion(opened.db)).toBe('ES');
  });
});
