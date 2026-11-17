import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, schema, type OpenedDatabase } from '../src/db/index.js';
import {
  CSRF_FIELD,
  LOGIN_CSRF_COOKIE,
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  dashboardAuthPlugin,
  ensureAdmin,
  loadConfig,
  parseCookies,
  tokenAuthPlugin,
} from '../src/index.js';

const PASSWORD = 'correct horse battery staple';

let opened: OpenedDatabase;
let app: FastifyInstance;
let clock: Date;

async function build(rateLimit = { max: 3, windowMs: 60_000 }): Promise<void> {
  app = Fastify();
  await app.register(tokenAuthPlugin, { db: opened.db });
  await app.register(dashboardAuthPlugin, { db: opened.db, rateLimit, now: () => clock });
  app.get('/contacts', () => ({ ok: true }));
  app.post('/settings', () => ({ saved: true }));
  app.get('/healthz', () => ({ ok: true }));
  await app.ready();
}

beforeEach(async () => {
  opened = openDatabase({ path: ':memory:' });
  clock = new Date('2026-01-01T00:00:00.000Z');
  await ensureAdmin(opened.db, PASSWORD, clock);
  await build();
});
afterEach(async () => {
  await app.close();
  opened.close();
});

/** Cookies set by a response, as a name -> raw Set-Cookie line map. */
function setCookies(res: { headers: Record<string, unknown> }): Record<string, string> {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf('=')), l]));
}
const valueOf = (line: string | undefined): string =>
  (line ?? '').split(';')[0]?.split('=')[1] ?? '';

async function loginCsrf(): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/login' });
  return valueOf(setCookies(res)[LOGIN_CSRF_COOKIE]);
}

async function login(password = PASSWORD, csrf?: string) {
  const token = csrf ?? (await loginCsrf());
  return app.inject({
    method: 'POST',
    url: '/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `${LOGIN_CSRF_COOKIE}=${token}`,
    },
    payload: new URLSearchParams({ password, [CSRF_FIELD]: token }).toString(),
  });
}

async function session(): Promise<string> {
  const res = await login();
  expect(res.statusCode).toBe(303);
  return valueOf(setCookies(res)[SESSION_COOKIE]);
}

const sessionCsrf = (): string =>
  opened.db.select().from(schema.adminSession).get()?.csrfToken ?? '';

const withSession = (id: string) => ({ cookie: `${SESSION_COOKIE}=${id}` });

describe('admin setup', () => {
  it('stores an argon2id hash, never the password', () => {
    const row = opened.db.select().from(schema.adminUser).get();
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
  });

  it('does not overwrite the password on later startups', async () => {
    const before = opened.db.select().from(schema.adminUser).get();
    expect(await ensureAdmin(opened.db, 'a different password!!', clock)).toBe('exists');
    expect(opened.db.select().from(schema.adminUser).get()).toEqual(before);
  });

  it('reports a missing password when there is no admin yet', async () => {
    const empty = openDatabase({ path: ':memory:' });
    expect(await ensureAdmin(empty.db, undefined)).toBe('missing');
    empty.close();
  });

  it('rejects a too-short ADMIN_PASSWORD in the config', () => {
    const env = {
      DATABASE_PATH: ':memory:',
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      ADMIN_PASSWORD: 'short',
    };
    expect(() => loadConfig(env)).toThrow(/ADMIN_PASSWORD/);
    expect(loadConfig({ ...env, ADMIN_PASSWORD: PASSWORD }).adminPassword).toBe(PASSWORD);
  });
});

describe('route protection', () => {
  it('redirects every dashboard route to the login without a session', async () => {
    for (const url of ['/', '/contacts', '/anything/else', '/settings']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(302);
      expect(res.headers.location).toBe('/login');
    }
  });

  it('answers 401 instead of redirecting for unauthenticated writes', async () => {
    const res = await app.inject({ method: 'POST', url: '/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('leaves the login, health and token-protected API outside the session guard', async () => {
    expect((await app.inject({ method: 'GET', url: '/login' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/contacts' })).statusCode).toBe(401);
  });

  it('rejects an unknown or forged session cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/contacts',
      headers: withSession('forged'),
    });
    expect(res.statusCode).toBe(302);
  });
});

describe('login', () => {
  it('logs in with the right password and sets a hardened cookie', async () => {
    const res = await login();
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/');
    const line = setCookies(res)[SESSION_COOKIE] ?? '';
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) {
      expect(line).toContain(attr);
    }
    expect(line).not.toContain('Domain');
    const id = valueOf(line);
    expect(id.length).toBeGreaterThanOrEqual(43);
    const page = await app.inject({ method: 'GET', url: '/contacts', headers: withSession(id) });
    expect(page.statusCode).toBe(200);
  });

  it('stores only a hash of the session id', async () => {
    const id = await session();
    const rows = opened.db.select().from(schema.adminSession).all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(id);
  });

  it('rejects a wrong password without creating a session', async () => {
    const res = await login('wrong password');
    expect(res.statusCode).toBe(401);
    expect(setCookies(res)[SESSION_COOKIE]).toBeUndefined();
    expect(res.body).toContain('Incorrect password');
    expect(opened.db.select().from(schema.adminSession).all()).toHaveLength(0);
  });

  it('rejects any login when no admin exists', async () => {
    opened.db.delete(schema.adminUser).run();
    expect((await login()).statusCode).toBe(401);
  });

  it('rate limits repeated failures, even with the right password afterwards', async () => {
    for (let i = 0; i < 3; i++) expect((await login('nope')).statusCode).toBe(401);
    const blocked = await login();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    clock = new Date(clock.getTime() + 61_000);
    expect((await login()).statusCode).toBe(303);
  });

  it('redirects an already logged-in visitor away from the login page', async () => {
    const id = await session();
    const res = await app.inject({ method: 'GET', url: '/login', headers: withSession(id) });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});

describe('session expiry', () => {
  it('expires after the idle limit', async () => {
    const id = await session();
    clock = new Date(clock.getTime() + SESSION_IDLE_MS);
    const res = await app.inject({ method: 'GET', url: '/contacts', headers: withSession(id) });
    expect(res.statusCode).toBe(302);
    expect(opened.db.select().from(schema.adminSession).all()).toHaveLength(0);
  });

  it('stays alive while active, up to the absolute limit', async () => {
    const id = await session();
    const step = SESSION_IDLE_MS - 60_000;
    for (let elapsed = 0; elapsed + step < SESSION_ABSOLUTE_MS; elapsed += step) {
      clock = new Date(clock.getTime() + step);
      const res = await app.inject({ method: 'GET', url: '/contacts', headers: withSession(id) });
      expect(res.statusCode).toBe(200);
    }
    clock = new Date(Date.parse('2026-01-01T00:00:00.000Z') + SESSION_ABSOLUTE_MS);
    const res = await app.inject({ method: 'GET', url: '/contacts', headers: withSession(id) });
    expect(res.statusCode).toBe(302);
  });
});

describe('logout', () => {
  it('invalidates the session on the server, so a replayed cookie fails', async () => {
    const id = await session();
    const csrf = sessionCsrf();
    const res = await app.inject({
      method: 'POST',
      url: '/logout',
      headers: { ...withSession(id), 'x-csrf-token': csrf },
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/login');
    expect(setCookies(res)[SESSION_COOKIE]).toContain('Max-Age=0');
    expect(opened.db.select().from(schema.adminSession).all()).toHaveLength(0);

    const replay = await app.inject({ method: 'GET', url: '/contacts', headers: withSession(id) });
    expect(replay.statusCode).toBe(302);
  });
});

describe('CSRF', () => {
  it('rejects a login without the CSRF token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { 'content-type': 'application/json' },
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a login whose token does not match the cookie', async () => {
    const real = await loginCsrf();
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      headers: {
        'content-type': 'application/json',
        cookie: `${LOGIN_CSRF_COOKIE}=${real}`,
      },
      payload: { password: PASSWORD, [CSRF_FIELD]: 'attacker-value' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects state-changing requests with a session but no or a wrong token', async () => {
    const id = await session();
    for (const headers of [{}, { 'x-csrf-token': 'wrong' }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/settings',
        headers: { ...withSession(id), ...headers },
      });
      expect(res.statusCode).toBe(403);
    }
    const out = await app.inject({ method: 'POST', url: '/logout', headers: withSession(id) });
    expect(out.statusCode).toBe(403);
    expect(opened.db.select().from(schema.adminSession).all()).toHaveLength(1);
  });

  it('accepts the session token as a header or a form field', async () => {
    const id = await session();
    const csrf = sessionCsrf();
    const viaHeader = await app.inject({
      method: 'POST',
      url: '/settings',
      headers: { ...withSession(id), 'x-csrf-token': csrf },
    });
    expect(viaHeader.statusCode).toBe(200);
    const viaForm = await app.inject({
      method: 'POST',
      url: '/settings',
      headers: { ...withSession(id), 'content-type': 'application/x-www-form-urlencoded' },
      payload: `${CSRF_FIELD}=${csrf}`,
    });
    expect(viaForm.statusCode).toBe(200);
  });

  it('rejects cross-origin state-changing requests even with a valid token', async () => {
    const id = await session();
    const csrf = sessionCsrf();
    const res = await app.inject({
      method: 'POST',
      url: '/settings',
      headers: {
        ...withSession(id),
        'x-csrf-token': csrf,
        host: 'brevolt.example',
        origin: 'https://evil.example',
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('login E2E over HTTP', () => {
  it('goes from redirect to login to dashboard to logout', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const base = `http://127.0.0.1:${String((addr as { port: number }).port)}`;
    const manual = { redirect: 'manual' as const };

    const first = await fetch(`${base}/`, manual);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe('/login');

    const form = await fetch(`${base}/login`, manual);
    const csrf = parseCookies(form.headers.getSetCookie().join('; '))[LOGIN_CSRF_COOKIE] ?? '';
    const html = await form.text();
    expect(html).toContain(`name="${CSRF_FIELD}" value="${csrf}"`);

    const post = await fetch(`${base}/login`, {
      ...manual,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `${LOGIN_CSRF_COOKIE}=${csrf}`,
      },
      body: new URLSearchParams({ password: PASSWORD, [CSRF_FIELD]: csrf }),
    });
    expect(post.status).toBe(303);
    const cookieHeader = post.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .filter((c) => c?.startsWith(SESSION_COOKIE))
      .join('; ');

    const home = await fetch(`${base}/`, { ...manual, headers: { cookie: cookieHeader } });
    expect(home.status).toBe(200);
    const homeHtml = await home.text();
    const sessionCsrf = /name="_csrf" value="([^"]+)"/.exec(homeHtml)?.[1] ?? '';

    const out = await fetch(`${base}/logout`, {
      ...manual,
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ [CSRF_FIELD]: sessionCsrf }),
    });
    expect(out.status).toBe(303);

    const after = await fetch(`${base}/`, { ...manual, headers: { cookie: cookieHeader } });
    expect(after.status).toBe(302);
    expect(opened.db.select().from(schema.adminSession).all()).toHaveLength(0);
  });
});
