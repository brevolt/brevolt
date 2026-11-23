import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, schema, type OpenedDatabase } from '../src/db/index.js';
import {
  ContactService,
  LOGIN_CSRF_COOKIE,
  SESSION_COOKIE,
  buildApp,
  createClientToken,
  ensureAdmin,
} from '../src/index.js';

const PASSWORD = 'correct horse battery staple';
let opened: OpenedDatabase;
let app: FastifyInstance;
let token: string;
let session: { cookie: string; csrf: string };

const cookieOf = (res: { headers: Record<string, unknown> }, name: string): string => {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [String(raw)];
  return (lines.find((l) => l.startsWith(`${name}=`)) ?? '').split(';')[0]?.split('=')[1] ?? '';
};

beforeEach(async () => {
  opened = openDatabase({ path: ':memory:' });
  await ensureAdmin(opened.db, PASSWORD);
  app = buildApp({ db: opened.db });
  await app.ready();
  token = createClientToken(opened.db, { kind: 'bridge-macos', name: 'mac' }).token;
  const pre = await app.inject({ method: 'GET', url: '/login/csrf' });
  const lc = pre.json<{ csrfToken: string }>().csrfToken;
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    headers: { 'x-csrf-token': lc, cookie: `${LOGIN_CSRF_COOKIE}=${lc}` },
    payload: { password: PASSWORD },
  });
  session = {
    cookie: `${SESSION_COOKIE}=${cookieOf(res, SESSION_COOKIE)}`,
    csrf: res.json<{ csrfToken: string }>().csrfToken,
  };
  new ContactService(opened.db).create(
    {
      givenName: 'Ada',
      familyNames: 'Lovelace',
      fields: [{ kind: 'email', label: 'work', value: 'ada@example.com' }],
    },
    { actor: 'dashboard', operationId: 'op-1', now: new Date() },
  );
});
afterEach(async () => {
  await app.close();
  opened.close();
});

const pending = () =>
  app.inject({
    method: 'GET',
    url: '/v1/bridge/pending',
    headers: { authorization: `Bearer ${token}` },
  });
const state = () =>
  app.inject({ method: 'GET', url: '/api/sync/icloud', headers: { cookie: session.cookie } });
const setDry = (payload: object) =>
  app.inject({
    method: 'PUT',
    url: '/api/sync/icloud/dry-run',
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
    payload,
  });
const queueRows = () => opened.db.select().from(schema.bridgePending).all().length;

describe('dry-run mode', () => {
  it('is on by default and shows the full diff', async () => {
    const body = (await state()).json<{
      dryRun: boolean;
      diff: { action: string; name: string; changes: { field: string; after: string | null }[] }[];
    }>();
    expect(body.dryRun).toBe(true);
    expect(body.diff).toHaveLength(1);
    expect(body.diff[0]).toMatchObject({ action: 'create', name: 'Ada Lovelace' });
    expect(body.diff[0]?.changes).toContainEqual(
      expect.objectContaining({ field: 'email', after: 'ada@example.com' }),
    );
  });

  it('performs zero external writes: the bridge gets nothing and nothing is queued', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await pending()).json<{ changes: unknown[] }>().changes).toEqual([]);
      await state();
    }
    expect(queueRows()).toBe(0);
    expect(opened.db.select().from(schema.externalLink).all()).toHaveLength(0);
    expect(opened.db.select().from(schema.syncBase).all()).toHaveLength(0);
  });

  it('requires explicit confirmation to turn off, then the bridge receives the changes', async () => {
    expect((await setDry({ enabled: false })).statusCode).toBe(409);
    expect((await setDry({ enabled: false, confirm: false })).statusCode).toBe(409);
    expect((await state()).json<{ dryRun: boolean }>().dryRun).toBe(true);

    const off = await setDry({ enabled: false, confirm: true });
    expect(off.statusCode).toBe(200);
    expect(off.json<{ dryRun: boolean }>().dryRun).toBe(false);
    expect((await pending()).json<{ changes: unknown[] }>().changes).toHaveLength(1);

    // Turning it back on needs no confirmation and stops delivery again.
    expect((await setDry({ enabled: true })).json<{ dryRun: boolean }>().dryRun).toBe(true);
  });

  it('guards the endpoints: session and CSRF are required', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/sync/icloud' })).statusCode).toBe(401);
    const noCsrf = await app.inject({
      method: 'PUT',
      url: '/api/sync/icloud/dry-run',
      headers: { cookie: session.cookie },
      payload: { enabled: false, confirm: true },
    });
    expect(noCsrf.statusCode).toBeGreaterThanOrEqual(400);
    expect((await state()).json<{ dryRun: boolean }>().dryRun).toBe(true);
  });
});
