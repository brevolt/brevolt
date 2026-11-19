import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, schema, type OpenedDatabase } from '../src/db/index.js';
import {
  LOGIN_CSRF_COOKIE,
  SESSION_COOKIE,
  createClientToken,
  dashboardAuthPlugin,
  ensureAdmin,
  tokenAuthPlugin,
} from '../src/index.js';

const PASSWORD = 'correct horse battery staple';
const NEXT = 'another very long passphrase';
const URL = '/api/settings/password';

let opened: OpenedDatabase;
let app: FastifyInstance;
const clock = new Date('2026-01-01T00:00:00.000Z');

beforeEach(async () => {
  opened = openDatabase({ path: ':memory:' });
  await ensureAdmin(opened.db, PASSWORD, clock);
  app = Fastify();
  await app.register(tokenAuthPlugin, { db: opened.db });
  await app.register(dashboardAuthPlugin, {
    db: opened.db,
    rateLimit: { max: 3, windowMs: 60_000 },
    now: () => clock,
  });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  opened.close();
});

const cookieValue = (res: { headers: Record<string, unknown> }, name: string): string => {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  const line = lines.find((l) => l.startsWith(`${name}=`));
  return line?.split(';')[0]?.split('=')[1] ?? '';
};

async function login(password: string) {
  const csrf = (await app.inject({ method: 'GET', url: '/login/csrf' })).json<{
    csrfToken: string;
  }>().csrfToken;
  return app.inject({
    method: 'POST',
    url: '/login',
    headers: { 'x-csrf-token': csrf, cookie: `${LOGIN_CSRF_COOKIE}=${csrf}` },
    payload: { password },
  });
}

async function signIn(): Promise<{ id: string; csrf: string }> {
  const res = await login(PASSWORD);
  expect(res.statusCode).toBe(200);
  return {
    id: cookieValue(res, SESSION_COOKIE),
    csrf: res.json<{ csrfToken: string }>().csrfToken,
  };
}

const change = (
  s: { id: string; csrf: string } | null,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: 'POST',
    url: URL,
    headers: {
      ...(s ? { cookie: `${SESSION_COOKIE}=${s.id}`, 'x-csrf-token': s.csrf } : {}),
      ...headers,
    },
    payload: body,
  });

const valid = { currentPassword: PASSWORD, newPassword: NEXT, repeatPassword: NEXT };

describe('POST /api/settings/password', () => {
  it('changes the password, keeps this session and ends the others', async () => {
    const a = await signIn();
    const b = await signIn();
    const res = await change(a, valid);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(NEXT);
    expect(res.body).not.toContain(PASSWORD);

    const rotatedId = cookieValue(res, SESSION_COOKIE);
    expect(rotatedId).not.toBe('');
    expect(rotatedId).not.toBe(a.id);
    const rotated = { id: rotatedId, csrf: res.json<{ csrfToken: string }>().csrfToken };
    const alive = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: `${SESSION_COOKIE}=${rotated.id}` },
    });
    expect(alive.statusCode).not.toBe(401);
    expect(alive.statusCode).not.toBe(302);
    for (const old of [a, b]) {
      const dead = await app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { cookie: `${SESSION_COOKIE}=${old.id}` },
      });
      expect(dead.statusCode).toBe(401);
    }
    expect(opened.db.select().from(schema.adminSession).all()).toHaveLength(1);

    expect((await login(PASSWORD)).statusCode).toBe(401);
    expect((await login(NEXT)).statusCode).toBe(200);
    const row = opened.db.select().from(schema.adminUser).get();
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects a wrong current password and leaves it unchanged', async () => {
    const s = await signIn();
    const res = await change(s, { ...valid, currentPassword: 'not the password!!' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'invalid_current_password' });
    expect((await login(PASSWORD)).statusCode).toBe(200);
  });

  it.each([
    ['too short', { newPassword: 'short', repeatPassword: 'short' }, 'password_too_short'],
    [
      'equal to the current one',
      { newPassword: PASSWORD, repeatPassword: PASSWORD },
      'password_unchanged',
    ],
    ['not matching', { repeatPassword: 'something else entirely' }, 'password_mismatch'],
    ['missing fields', { repeatPassword: undefined }, 'invalid_body'],
  ])('rejects a new password that is %s', async (_n, patch, error) => {
    const s = await signIn();
    const res = await change(s, { ...valid, ...patch });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error });
    expect((await login(PASSWORD)).statusCode).toBe(200);
  });

  it('requires a session', async () => {
    expect((await change(null, valid)).statusCode).toBe(401);
  });

  it('requires the CSRF token', async () => {
    const s = await signIn();
    expect((await change({ ...s, csrf: 'forged' }, valid)).statusCode).toBe(403);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { cookie: `${SESSION_COOKIE}=${s.id}` },
      payload: valid,
    });
    expect(res.statusCode).toBe(403);
    expect((await login(PASSWORD)).statusCode).toBe(200);
  });

  it('answers 403 to client tokens', async () => {
    const { token } = createClientToken(opened.db, { name: 't', kind: 'obsidian' }, clock);
    const res = await change(null, valid, { authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(403);
    expect((await login(PASSWORD)).statusCode).toBe(200);
  });

  it('rate-limits repeated wrong current passwords', async () => {
    const s = await signIn();
    for (let i = 0; i < 3; i++) {
      expect((await change(s, { ...valid, currentPassword: 'wrong wrong wrong' })).statusCode).toBe(
        403,
      );
    }
    const blocked = await change(s, valid);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect((await login(PASSWORD)).statusCode).toBe(429);
  });
});
