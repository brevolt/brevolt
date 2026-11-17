import { createHash, randomBytes } from 'node:crypto';
import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { eq, lt } from 'drizzle-orm';
import { adminSession, adminUser } from '../db/schema.js';
import type { HubDatabase } from '../db/index.js';

/** Sessions end after this long without activity. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Sessions end this long after login regardless of activity. */
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** Only touch `last_seen_at` when it is older than this, to avoid a write per request. */
const TOUCH_GRANULARITY_MS = 60 * 1000;

const ADMIN_ID = 1;

/** OWASP-recommended argon2id parameters (19 MiB, 2 passes, 1 lane). */
/** `Algorithm.Argon2id` is a const enum, which verbatimModuleSyntax forbids using; its value is 2. */
const ARGON2 = {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  try {
    return await verify(phc, password);
  } catch {
    return false;
  }
}

/** Verified against when no admin exists, so login timing does not reveal that state. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/**
 * First-startup setup: stores the admin password hash only if no admin exists yet.
 * Later calls never overwrite it, so changing the environment does not reset the password.
 */
export async function ensureAdmin(
  db: HubDatabase,
  password: string | undefined,
  now: Date = new Date(),
): Promise<'exists' | 'created' | 'missing'> {
  if (db.select().from(adminUser).where(eq(adminUser.id, ADMIN_ID)).get()) return 'exists';
  if (!password) return 'missing';
  const passwordHash = await hashPassword(password);
  const result = db
    .insert(adminUser)
    .values({ id: ADMIN_ID, passwordHash, createdAt: now.toISOString() })
    .onConflictDoNothing()
    .run();
  return result.changes > 0 ? 'created' : 'exists';
}

export function getAdminPasswordHash(db: HubDatabase): string | null {
  return db.select().from(adminUser).where(eq(adminUser.id, ADMIN_ID)).get()?.passwordHash ?? null;
}

export function hashSessionId(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

export interface CreatedSession {
  /** Cookie value. Only its hash is stored. */
  id: string;
  csrfToken: string;
  expiresAt: Date;
}

export function createSession(db: HubDatabase, now: Date = new Date()): CreatedSession {
  const id = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  db.delete(adminSession).where(lt(adminSession.expiresAt, now.toISOString())).run();
  db.insert(adminSession)
    .values({
      idHash: hashSessionId(id),
      csrfToken,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
    .run();
  return { id, csrfToken, expiresAt };
}

export interface ActiveSession {
  csrfToken: string;
}

/** Returns the session if valid; expired sessions are deleted on the spot. */
export function resolveSession(
  db: HubDatabase,
  id: string,
  now: Date = new Date(),
): ActiveSession | null {
  const key = hashSessionId(id);
  const row = db.select().from(adminSession).where(eq(adminSession.idHash, key)).get();
  if (!row) return null;
  const t = now.getTime();
  if (t >= Date.parse(row.expiresAt) || t - Date.parse(row.lastSeenAt) >= SESSION_IDLE_MS) {
    db.delete(adminSession).where(eq(adminSession.idHash, key)).run();
    return null;
  }
  if (t - Date.parse(row.lastSeenAt) > TOUCH_GRANULARITY_MS) {
    db.update(adminSession)
      .set({ lastSeenAt: now.toISOString() })
      .where(eq(adminSession.idHash, key))
      .run();
  }
  return { csrfToken: row.csrfToken };
}

/** Server-side logout: after this the cookie value is worthless even if replayed. */
export function destroySession(db: HubDatabase, id: string): void {
  db.delete(adminSession)
    .where(eq(adminSession.idHash, hashSessionId(id)))
    .run();
}
