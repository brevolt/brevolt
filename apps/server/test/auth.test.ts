import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, schema, type OpenedDatabase } from '../src/db/index.js';
import {
  INACTIVITY_LIMIT_MS,
  constantTimeEqual,
  createClientToken,
  hashToken,
  revokeClientToken,
  tokenAuthPlugin,
  verifyToken,
} from '../src/index.js';
import { eq } from 'drizzle-orm';

let opened: OpenedDatabase;
let app: FastifyInstance;
let clock: Date;

async function build(rateLimit = { max: 3, windowMs: 60_000 }): Promise<void> {
  app = Fastify();
  await app.register(tokenAuthPlugin, { db: opened.db, rateLimit, now: () => clock });
  for (const path of [
    '/v1/bridge/changes',
    '/v1/contacts',
    '/v1/contacts/abc',
    '/v1/export',
    '/v1/bridgeX',
  ]) {
    app.get(path, (req) => ({ ok: true, scope: req.client?.scope }));
  }
  app.get('/healthz', () => ({ ok: true }));
  await app.ready();
}

beforeEach(async () => {
  opened = openDatabase({ path: ':memory:' });
  clock = new Date('2026-01-01T00:00:00.000Z');
  await build();
});
afterEach(async () => {
  await app.close();
  opened.close();
});

const get = (url: string, token?: string) =>
  app.inject({
    method: 'GET',
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe('token creation', () => {
  it('returns the plain value once and stores only its hash', () => {
    const { id, token } = createClientToken(opened.db, { kind: 'obsidian', name: 'vault' }, clock);
    const row = opened.db.select().from(schema.client).where(eq(schema.client.id, id)).get();
    expect(row?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('generates distinct high-entropy tokens', () => {
    const a = createClientToken(opened.db, { kind: 'obsidian', name: 'a' });
    const b = createClientToken(opened.db, { kind: 'obsidian', name: 'b' });
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
  });
});

describe('scopes', () => {
  const matrix: [string, 'bridge-macos' | 'obsidian', string, number][] = [
    ['bridge', 'bridge-macos', '/v1/bridge/changes', 200],
    ['bridge', 'bridge-macos', '/v1/contacts', 403],
    ['bridge', 'bridge-macos', '/v1/contacts/abc', 403],
    ['bridge', 'bridge-macos', '/v1/export', 403],
    ['obsidian', 'obsidian', '/v1/contacts', 200],
    ['obsidian', 'obsidian', '/v1/contacts/abc', 200],
    ['obsidian', 'obsidian', '/v1/bridge/changes', 403],
    ['obsidian', 'obsidian', '/v1/export', 403],
  ];
  it.each(matrix)('%s token on %s → %i', async (_n, kind, path, status) => {
    const { token } = createClientToken(opened.db, { kind, name: 'c' }, clock);
    const res = await get(path, token);
    expect(res.statusCode).toBe(status);
  });

  it('does not match prefix lookalikes', async () => {
    const { token } = createClientToken(opened.db, { kind: 'bridge-macos', name: 'c' }, clock);
    expect((await get('/v1/bridgeX', token)).statusCode).toBe(403);
  });

  it('ignores the query string when matching scope', async () => {
    const { token } = createClientToken(opened.db, { kind: 'bridge-macos', name: 'c' }, clock);
    expect((await get('/v1/contacts?x=/v1/bridge/', token)).statusCode).toBe(403);
  });

  it('leaves non-/v1 routes unauthenticated', async () => {
    expect((await get('/healthz')).statusCode).toBe(200);
  });

  it('rejects missing, malformed and unknown tokens with 401', async () => {
    expect((await get('/v1/contacts')).statusCode).toBe(401);
    expect((await get('/v1/contacts', 'brv_nope')).statusCode).toBe(401);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/contacts',
      headers: { authorization: 'Basic abc' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('lifecycle', () => {
  it('stops working after 90 days without use', async () => {
    const { token } = createClientToken(opened.db, { kind: 'obsidian', name: 'c' }, clock);
    clock = new Date(clock.getTime() + INACTIVITY_LIMIT_MS - 1000);
    expect((await get('/v1/contacts', token)).statusCode).toBe(200);
    clock = new Date(clock.getTime() + INACTIVITY_LIMIT_MS - 1000);
    expect((await get('/v1/contacts', token)).statusCode).toBe(200);
    clock = new Date(clock.getTime() + INACTIVITY_LIMIT_MS + 1000);
    expect((await get('/v1/contacts', token)).statusCode).toBe(401);
    expect(verifyToken(opened.db, token, clock)).toEqual({ ok: false, reason: 'expired' });
  });

  it('expires a never-used token 90 days after creation', () => {
    const { token } = createClientToken(opened.db, { kind: 'obsidian', name: 'c' }, clock);
    const later = new Date(clock.getTime() + INACTIVITY_LIMIT_MS + 1000);
    expect(verifyToken(opened.db, token, later)).toEqual({ ok: false, reason: 'expired' });
  });

  it('records last_seen on use', async () => {
    const { id, token } = createClientToken(opened.db, { kind: 'obsidian', name: 'c' }, clock);
    await get('/v1/contacts', token);
    const row = opened.db.select().from(schema.client).where(eq(schema.client.id, id)).get();
    expect(row?.lastSeen).toBe(clock.toISOString());
  });

  it('rejects revoked tokens', async () => {
    const { id, token } = createClientToken(opened.db, { kind: 'obsidian', name: 'c' }, clock);
    expect((await get('/v1/contacts', token)).statusCode).toBe(200);
    expect(revokeClientToken(opened.db, id, clock)).toBe(true);
    expect(revokeClientToken(opened.db, id, clock)).toBe(false);
    expect((await get('/v1/contacts', token)).statusCode).toBe(401);
  });
});

describe('rate limiting', () => {
  it('blocks an address with 429 after too many failures, then recovers', async () => {
    const { token } = createClientToken(opened.db, { kind: 'obsidian', name: 'c' }, clock);
    for (let i = 0; i < 3; i++) expect((await get('/v1/contacts', 'brv_bad')).statusCode).toBe(401);
    const blocked = await get('/v1/contacts', token);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    clock = new Date(clock.getTime() + 61_000);
    expect((await get('/v1/contacts', token)).statusCode).toBe(200);
  });

  it('does not count successful requests', async () => {
    const { token } = createClientToken(opened.db, { kind: 'obsidian', name: 'c' }, clock);
    for (let i = 0; i < 10; i++) expect((await get('/v1/contacts', token)).statusCode).toBe(200);
  });
});

describe('constantTimeEqual', () => {
  it('compares correctly, including different lengths', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
