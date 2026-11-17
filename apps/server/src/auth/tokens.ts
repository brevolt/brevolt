import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { client } from '../db/schema.js';
import type { HubDatabase } from '../db/index.js';

export type ClientKind = 'bridge-macos' | 'obsidian';
export type TokenScope = 'bridge' | 'obsidian';

/** Each client kind maps to exactly one scope (R-SEC-7). */
export const SCOPE_BY_KIND: Record<ClientKind, TokenScope> = {
  'bridge-macos': 'bridge',
  obsidian: 'obsidian',
};

/** Tokens unused for this long stop working (R-SEC-7). */
export const INACTIVITY_LIMIT_MS = 90 * 24 * 60 * 60 * 1000;

const TOKEN_PREFIX = 'brv_';
/** Only touch `last_seen` when it is older than this, to avoid a write per request. */
const LAST_SEEN_GRANULARITY_MS = 60 * 1000;

/** Tokens are 256 random bits, so a plain SHA-256 is enough; no salt or slow hash needed. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time string comparison; unequal lengths return false without leaking content. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface CreatedToken {
  id: string;
  /** Plain token value. Returned only here; only its hash is stored. */
  token: string;
  kind: ClientKind;
  name: string;
}

export function createClientToken(
  db: HubDatabase,
  input: { kind: ClientKind; name: string },
  now: Date = new Date(),
): CreatedToken {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const id = randomUUID();
  db.insert(client)
    .values({
      id,
      kind: input.kind,
      name: input.name,
      tokenHash: hashToken(token),
      createdAt: now.toISOString(),
    })
    .run();
  return { id, token, kind: input.kind, name: input.name };
}

/** Returns true if a token was revoked now. Idempotent. */
export function revokeClientToken(db: HubDatabase, id: string, now: Date = new Date()): boolean {
  const row = db.select().from(client).where(eq(client.id, id)).get();
  if (!row || row.revokedAt) return false;
  db.update(client).set({ revokedAt: now.toISOString() }).where(eq(client.id, id)).run();
  return true;
}

export interface AuthenticatedClient {
  id: string;
  kind: ClientKind;
  scope: TokenScope;
  name: string;
}

export type VerifyFailure = 'invalid' | 'revoked' | 'expired';

export type VerifyResult =
  { ok: true; client: AuthenticatedClient } | { ok: false; reason: VerifyFailure };

export function verifyToken(db: HubDatabase, token: string, now: Date = new Date()): VerifyResult {
  if (!token.startsWith(TOKEN_PREFIX)) return { ok: false, reason: 'invalid' };
  const hash = hashToken(token);
  const row = db.select().from(client).where(eq(client.tokenHash, hash)).get();
  if (!row || !constantTimeEqual(row.tokenHash, hash)) return { ok: false, reason: 'invalid' };
  if (row.revokedAt) return { ok: false, reason: 'revoked' };

  const lastUse = Date.parse(row.lastSeen ?? row.createdAt);
  if (now.getTime() - lastUse > INACTIVITY_LIMIT_MS) return { ok: false, reason: 'expired' };

  if (!row.lastSeen || now.getTime() - Date.parse(row.lastSeen) > LAST_SEEN_GRANULARITY_MS) {
    db.update(client).set({ lastSeen: now.toISOString() }).where(eq(client.id, row.id)).run();
  }
  return {
    ok: true,
    client: { id: row.id, kind: row.kind, scope: SCOPE_BY_KIND[row.kind], name: row.name },
  };
}
