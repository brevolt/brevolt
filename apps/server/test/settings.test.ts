import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, schema, type OpenedDatabase } from '../src/db/index.js';
import { LOGIN_CSRF_COOKIE, SESSION_COOKIE, buildApp, ensureAdmin } from '../src/index.js';
import { getPhoneRegion } from '../src/index.js';
import { createClientToken } from '../src/index.js';

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

interface Session {
  cookie: string;
  csrf: string;
}

async function loginSession(): Promise<Session> {
  const pre = await app.inject({ method: 'GET', url: '/login/csrf' });
  const loginCsrf = pre.json<{ csrfToken: string }>().csrfToken;
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    headers: { 'x-csrf-token': loginCsrf, cookie: `${LOGIN_CSRF_COOKIE}=${loginCsrf}` },
    payload: { password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return {
    cookie: `${SESSION_COOKIE}=${cookieValue(res, SESSION_COOKIE)}`,
    csrf: res.json<{ csrfToken: string }>().csrfToken,
  };
}

const get = (s: Session, url = '/api/settings') =>
  app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });

const send = (
  s: Session,
  method: 'POST' | 'PUT',
  url: string,
  payload: object = {},
  csrf: string | null = s.csrf,
) =>
  app.inject({
    method,
    url,
    headers: { cookie: s.cookie, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
    payload,
  });

interface SettingsBody {
  tokens: {
    id: string;
    name: string;
    scope: string;
    lastSeen: string | null;
    revokedAt: string | null;
  }[];
  region: string;
  systems: Record<string, string>;
}

describe('GET /api/settings', () => {
  it('requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects client tokens with 403', async () => {
    const { token } = createClientToken(opened.db, { kind: 'obsidian', name: 'v' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lists tokens, region and systems', async () => {
    const s = await loginSession();
    await send(s, 'POST', '/api/settings/tokens', { name: 'My Mac', kind: 'bridge-macos' });
    const res = await get(s);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<SettingsBody>();
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).toMatchObject({ name: 'My Mac', scope: 'bridge', lastSeen: null });
    expect(body.region).toBe('ES');
    expect(body.systems).toEqual({ google: 'ok', icloud: 'down' });
    expect(JSON.stringify(body)).not.toContain('brv_');
  });
});

describe('client tokens', () => {
  it('creates a token shown once, uses it against the API, then revokes it', async () => {
    const s = await loginSession();
    const created = await send(s, 'POST', '/api/settings/tokens', {
      name: 'Vault',
      kind: 'obsidian',
    });
    expect(created.statusCode).toBe(201);
    const { id, token } = created.json<{ id: string; token: string }>();
    expect(token).toMatch(/^brv_/);

    expect((await get(s)).body).not.toContain(token);
    expect(JSON.stringify(opened.db.select().from(schema.client).all())).not.toContain(token);

    const api = () =>
      app.inject({
        method: 'GET',
        url: '/v1/contacts',
        headers: { authorization: `Bearer ${token}` },
      });
    expect((await api()).statusCode).toBe(200);
    expect((await get(s)).json<SettingsBody>().tokens[0]?.lastSeen).not.toBeNull();

    const revoked = await send(s, 'POST', `/api/settings/tokens/${id}/revoke`);
    expect(revoked.statusCode).toBe(200);
    expect((await api()).statusCode).toBe(401);
    expect((await get(s)).json<SettingsBody>().tokens[0]?.revokedAt).not.toBeNull();
  });

  it('rejects writes without session, without CSRF and with client tokens', async () => {
    const s = await loginSession();
    const url = '/api/settings/tokens';
    const payload = { name: 'x', kind: 'obsidian' };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect((await send(s, 'POST', url, payload, null)).statusCode).toBe(403);
    expect((await send(s, 'POST', url, payload, 'wrong')).statusCode).toBe(403);
    const { token } = createClientToken(opened.db, { kind: 'bridge-macos', name: 'b' });
    const viaToken = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(viaToken.statusCode).toBe(403);
    expect(opened.db.select().from(schema.client).all()).toHaveLength(1);
  });

  it('rejects an invalid body', async () => {
    const s = await loginSession();
    expect(
      (await send(s, 'POST', '/api/settings/tokens', { name: '', kind: 'obsidian' })).statusCode,
    ).toBe(400);
    expect(
      (await send(s, 'POST', '/api/settings/tokens', { name: 'x', kind: 'admin' })).statusCode,
    ).toBe(400);
    expect(opened.db.select().from(schema.client).all()).toHaveLength(0);
  });

  it('guards revoke: session, CSRF, client token and id format', async () => {
    const s = await loginSession();
    const { id, token } = createClientToken(opened.db, { kind: 'obsidian', name: 'v' });
    const url = `/api/settings/tokens/${id}/revoke`;
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(401);
    expect((await send(s, 'POST', url, {}, null)).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` } }))
        .statusCode,
    ).toBe(403);
    expect((await send(s, 'POST', '/api/settings/tokens/not-a-uuid/revoke')).statusCode).toBe(404);
    expect(opened.db.select().from(schema.client).get()?.revokedAt).toBeNull();
  });
});

describe('default phone region', () => {
  it('defaults to ES, saves a valid region and applies it to new phones', async () => {
    const s = await loginSession();
    expect(getPhoneRegion(opened.db)).toBe('ES');
    const saved = await send(s, 'PUT', '/api/settings/region', { region: 'us' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<{ region: string }>().region).toBe('US');
    expect(getPhoneRegion(opened.db)).toBe('US');

    const { token } = createClientToken(opened.db, { kind: 'obsidian', name: 'c' });
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
      expect((await send(s, 'PUT', '/api/settings/region', { region })).statusCode).toBe(400);
    }
    expect(getPhoneRegion(opened.db)).toBe('ES');
  });

  it('guards the write: session, CSRF and client token', async () => {
    const s = await loginSession();
    const url = '/api/settings/region';
    expect((await app.inject({ method: 'PUT', url, payload: { region: 'US' } })).statusCode).toBe(
      401,
    );
    expect((await send(s, 'PUT', url, { region: 'US' }, null)).statusCode).toBe(403);
    const { token } = createClientToken(opened.db, { kind: 'obsidian', name: 'c' });
    const viaToken = await app.inject({
      method: 'PUT',
      url,
      payload: { region: 'US' },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(viaToken.statusCode).toBe(403);
    expect(getPhoneRegion(opened.db)).toBe('ES');
  });
});

describe('login JSON', () => {
  it('exposes the session CSRF to the SPA page when already signed in', async () => {
    const s = await loginSession();
    const dir = await import('node:fs').then((fs) => {
      const d = fs.mkdtempSync('/tmp/brv-spa-');
      fs.writeFileSync(`${d}/index.html`, '<meta name="csrf-token" content="__CSRF__">');
      return d;
    });
    const spa = buildApp({ db: opened.db, dashboardDir: dir });
    await spa.ready();
    const res = await spa.inject({ method: 'GET', url: '/login', headers: { cookie: s.cookie } });
    expect(res.body).toContain(`content="${s.csrf}"`);
    const anon = await spa.inject({ method: 'GET', url: '/login' });
    expect(anon.statusCode).toBe(200);
    expect(anon.body).toContain('content=""');
    await spa.close();
  });
});
