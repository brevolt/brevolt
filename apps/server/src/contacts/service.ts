import { and, asc, desc, eq, gt, inArray, isNull, like, lt, or, sql } from 'drizzle-orm';
import { birthdaySchema, contactFieldKindSchema, labelSchema } from '@brevolt/contracts';
import { getPhoneRegion } from '../settings/settings.js';
import { normalizeEmail, normalizeLabel, normalizePhone } from '@brevolt/core';
import { z } from 'zod';
import type { HubDatabase } from '../db/index.js';
import { changeLog, contact, contactField, contactTag, customField, tag } from '../db/schema.js';
import { uuidv7 } from './uuid.js';

const nullableText = z.string().nullable();

const scalarShape = {
  prefix: nullableText,
  givenName: nullableText,
  middleName: nullableText,
  familyNames: nullableText,
  suffix: nullableText,
  nickname: nullableText,
  company: nullableText,
  jobTitle: nullableText,
  birthday: birthdaySchema.nullable(),
  noteMd: z.string(),
};
const SCALARS = Object.keys(scalarShape) as (keyof typeof scalarShape)[];

const fieldInput = z.strictObject({
  kind: contactFieldKindSchema,
  label: labelSchema,
  value: z.string().trim().min(1),
});
const extras = {
  fields: z.array(fieldInput).max(200),
  tags: z.array(z.string().trim().min(1)).max(100),
  custom: z.record(z.string().min(1), z.string()),
};

export const createContactSchema = z.strictObject({
  ...Object.fromEntries(Object.entries(scalarShape).map(([k, v]) => [k, v.optional()])),
  fields: extras.fields.optional(),
  tags: extras.tags.optional(),
  custom: extras.custom.optional(),
} as { [K in keyof typeof scalarShape]: z.ZodOptional<(typeof scalarShape)[K]> } & {
  fields: z.ZodOptional<typeof extras.fields>;
  tags: z.ZodOptional<typeof extras.tags>;
  custom: z.ZodOptional<typeof extras.custom>;
});
/** PATCH has the same shape: only the keys present are changed; arrays replace the whole set. */
export const patchContactSchema = createContactSchema.refine(
  (v) => Object.keys(v).length > 0,
  'Empty patch',
);
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type PatchContactInput = z.infer<typeof patchContactSchema>;

export interface ContactView {
  id: string;
  version: number;
  prefix: string | null;
  givenName: string | null;
  middleName: string | null;
  familyNames: string | null;
  suffix: string | null;
  nickname: string | null;
  company: string | null;
  jobTitle: string | null;
  birthday: string | null;
  noteMd: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  fields: { id: string; kind: string; label: string; value: string; normalized: string }[];
  tags: string[];
  custom: Record<string, string>;
}

export interface ListOptions {
  updatedSince?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  order?: 'updated' | 'name' | undefined;
}

export interface HistoryEntry {
  operationId: string;
  ts: string;
  actor: string;
  fields: string[];
}

export interface WriteContext {
  /** Who originates the write, e.g. `client:<id>`. */
  actor: string;
  operationId: string;
  now: Date;
}

export type WriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'version_mismatch'; current: number };

/** Why an operation cannot be undone: the contact moved on since, so reverting would lose data. */
export type UndoResult =
  | { ok: true; value: ContactView }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'conflict'; fields: string[] };

export type Tx = Parameters<Parameters<HubDatabase['transaction']>[0]>[0];

export function normalizeValue(db: HubDatabase | Tx, kind: string, value: string): string {
  if (kind === 'phone')
    return normalizePhone(value, { defaultRegion: getPhoneRegion(db) }).normalized;
  if (kind === 'email') return normalizeEmail(value);
  return value.trim();
}

function load(db: HubDatabase | Tx, id: string): ContactView | null {
  const row = db.select().from(contact).where(eq(contact.id, id)).get();
  if (!row) return null;
  const fields = db
    .select()
    .from(contactField)
    .where(eq(contactField.contactId, id))
    .orderBy(contactField.position)
    .all();
  const tags = db
    .select({ name: tag.name })
    .from(contactTag)
    .innerJoin(tag, eq(tag.id, contactTag.tagId))
    .where(eq(contactTag.contactId, id))
    .orderBy(tag.name)
    .all();
  const custom = db.select().from(customField).where(eq(customField.contactId, id)).all();
  return {
    ...row,
    fields: fields.map((f) => ({
      id: f.id,
      kind: f.kind,
      label: f.label,
      value: f.value,
      normalized: f.normalized,
    })),
    tags: tags.map((t) => t.name),
    custom: Object.fromEntries(
      custom.sort((a, b) => a.key.localeCompare(b.key)).map((c) => [c.key, c.value]),
    ),
  };
}

function mustLoad(db: HubDatabase | Tx, id: string): ContactView {
  const found = load(db, id);
  if (!found) throw new Error(`Contact ${id} vanished inside a transaction`);
  return found;
}

function writeFields(tx: Tx, id: string, fields: z.infer<typeof fieldInput>[]): void {
  tx.delete(contactField).where(eq(contactField.contactId, id)).run();
  fields.forEach((f, position) => {
    const label = normalizeLabel(f.label);
    tx.insert(contactField)
      .values({
        id: uuidv7(),
        contactId: id,
        kind: f.kind,
        label,
        value: f.value,
        normalized: normalizeValue(tx, f.kind, f.value),
        position,
      })
      .run();
  });
}

function writeTags(tx: Tx, id: string, names: string[]): void {
  tx.delete(contactTag).where(eq(contactTag.contactId, id)).run();
  for (const name of new Set(names)) {
    let t = tx.select().from(tag).where(eq(tag.name, name)).get();
    if (!t) {
      t = { id: uuidv7(), name };
      tx.insert(tag).values(t).run();
    }
    tx.insert(contactTag).values({ contactId: id, tagId: t.id }).run();
  }
}

function writeCustom(tx: Tx, id: string, custom: Record<string, string>): void {
  tx.delete(customField).where(eq(customField.contactId, id)).run();
  for (const [key, value] of Object.entries(custom)) {
    tx.insert(customField).values({ contactId: id, key, value }).run();
  }
}

const json = (v: unknown): string | null =>
  v === null || v === undefined ? null : JSON.stringify(v);

/** One change_log row per changed logical field. Values are JSON text. */
function logChanges(
  tx: Tx,
  ctx: WriteContext,
  contactId: string,
  before: ContactView | null,
  after: ContactView,
): number {
  const ts = ctx.now.toISOString();
  const keys = [...SCALARS, 'fields', 'tags', 'custom', 'deletedAt'] as const;
  let n = 0;
  for (const key of keys) {
    const strip = (c: ContactView | null) =>
      key === 'fields'
        ? c?.fields.map(({ kind, label, value }) => ({ kind, label, value }))
        : c?.[key];
    const b = strip(before);
    const a = strip(after);
    const empty = (v: unknown) =>
      v === undefined ||
      v === null ||
      v === '' ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
    if (JSON.stringify(b ?? null) === JSON.stringify(a ?? null) || (empty(b) && empty(a))) continue;
    tx.insert(changeLog)
      .values({
        ts,
        actor: ctx.actor,
        contactId,
        field: key,
        before: json(b),
        after: json(a),
        operationId: ctx.operationId,
      })
      .run();
    n++;
  }
  return n;
}

export class ContactService {
  constructor(private readonly db: HubDatabase | Tx) {}

  get(id: string): ContactView | null {
    return load(this.db, id);
  }

  list(opts: ListOptions): ContactView[] {
    return this.listPage(opts).contacts;
  }

  /** One page of contacts plus the total number matching the filter (for the dashboard list). */
  listPage(opts: ListOptions): { contacts: ContactView[]; total: number } {
    const conds = [];
    // Clients syncing by cursor must also see deletions; plain listings hide them.
    if (opts.updatedSince) conds.push(gt(contact.updatedAt, opts.updatedSince));
    else conds.push(isNull(contact.deletedAt));
    if (opts.q) {
      const needle = `%${opts.q.replace(/[\\%_]/g, '\\$&')}%`;
      const ci = (col: unknown) => sql`${col} LIKE ${needle} ESCAPE '\\'`;
      const byField = this.db
        .select({ id: contactField.contactId })
        .from(contactField)
        .where(or(ci(contactField.value), like(contactField.normalized, needle)));
      conds.push(
        or(
          ci(contact.givenName),
          ci(contact.middleName),
          ci(contact.familyNames),
          ci(contact.nickname),
          ci(contact.company),
          inArray(contact.id, byField),
        ) ?? sql`1`,
      );
    }
    const where = and(...conds);
    const order =
      opts.order === 'name'
        ? [
            sql`lower(coalesce(${contact.familyNames}, ${contact.givenName}, ${contact.company}, ''))`,
            sql`lower(coalesce(${contact.givenName}, ''))`,
            contact.id,
          ]
        : [contact.updatedAt, contact.id];
    const ids = this.db
      .select({ id: contact.id })
      .from(contact)
      .where(where)
      .orderBy(...order)
      .limit(opts.limit ?? 200)
      .offset(opts.offset ?? 0)
      .all();
    const total =
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(contact)
        .where(where)
        .get()?.n ?? 0;
    return { contacts: ids.map((r) => mustLoad(this.db, r.id)), total };
  }

  /** Newest operations first, each grouping the fields it changed. */
  history(id: string, limit = 100): HistoryEntry[] {
    const rows = this.db
      .select()
      .from(changeLog)
      .where(eq(changeLog.contactId, id))
      .orderBy(desc(changeLog.id))
      .all();
    const byOp = new Map<string, HistoryEntry>();
    for (const r of rows) {
      let entry = byOp.get(r.operationId);
      if (!entry) {
        if (byOp.size >= limit) continue;
        entry = { operationId: r.operationId, ts: r.ts, actor: r.actor, fields: [] };
        byOp.set(r.operationId, entry);
      }
      entry.fields.unshift(r.field);
    }
    return [...byOp.values()];
  }

  create(input: CreateContactInput, ctx: WriteContext): ContactView {
    const id = uuidv7(ctx.now.getTime());
    const ts = ctx.now.toISOString();
    return this.db.transaction((tx) => {
      const scalars = Object.fromEntries(
        SCALARS.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]),
      );
      tx.insert(contact)
        .values({ ...scalars, id, version: 1, createdAt: ts, updatedAt: ts })
        .run();
      if (input.fields) writeFields(tx, id, input.fields);
      if (input.tags) writeTags(tx, id, input.tags);
      if (input.custom) writeCustom(tx, id, input.custom);
      const after = mustLoad(tx, id);
      logChanges(tx, ctx, id, null, after);
      return after;
    });
  }

  update(
    id: string,
    input: PatchContactInput,
    expected: number,
    ctx: WriteContext,
  ): WriteResult<ContactView> {
    return this.db.transaction((tx) => {
      const before = load(tx, id);
      if (!before || before.deletedAt) return { ok: false, reason: 'not_found' } as const;
      if (before.version !== expected) {
        return { ok: false, reason: 'version_mismatch', current: before.version } as const;
      }
      const scalars = Object.fromEntries(
        SCALARS.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]),
      );
      // Guarded update: a concurrent writer that bumped the version makes this match 0 rows.
      const res = tx
        .update(contact)
        .set({ ...scalars, version: expected + 1, updatedAt: ctx.now.toISOString() })
        .where(and(eq(contact.id, id), eq(contact.version, expected)))
        .run();
      if (res.changes === 0) {
        return {
          ok: false,
          reason: 'version_mismatch',
          current: load(tx, id)?.version ?? expected,
        } as const;
      }
      if (input.fields) writeFields(tx, id, input.fields);
      if (input.tags) writeTags(tx, id, input.tags);
      if (input.custom) writeCustom(tx, id, input.custom);
      const after = mustLoad(tx, id);
      logChanges(tx, ctx, id, before, after);
      return { ok: true, value: after } as const;
    });
  }

  /** Soft delete: sets `deleted_at`. Deleting an already deleted contact is `not_found`. */
  remove(id: string, expected: number | null, ctx: WriteContext): WriteResult<ContactView> {
    return this.db.transaction((tx) => {
      const before = load(tx, id);
      if (!before || before.deletedAt) return { ok: false, reason: 'not_found' } as const;
      if (expected !== null && before.version !== expected) {
        return { ok: false, reason: 'version_mismatch', current: before.version } as const;
      }
      const ts = ctx.now.toISOString();
      tx.update(contact)
        .set({ deletedAt: ts, updatedAt: ts, version: before.version + 1 })
        .where(eq(contact.id, id))
        .run();
      const after = mustLoad(tx, id);
      logChanges(tx, ctx, id, before, after);
      return { ok: true, value: after } as const;
    });
  }

  /** Every live contact, oldest first. Used by the full export. */
  listAll(): ContactView[] {
    const ids = this.db
      .select({ id: contact.id })
      .from(contact)
      .where(isNull(contact.deletedAt))
      .orderBy(contact.createdAt, contact.id)
      .all();
    return ids.map((r) => mustLoad(this.db, r.id));
  }

  /**
   * Reverts exactly one operation (all its `change_log` rows) and records the revert as a new
   * operation. Refuses with `conflict` when any touched field no longer holds the value the
   * operation wrote, which also makes a second undo of the same operation a no-op error.
   */
  undo(operationId: string, ctx: WriteContext): UndoResult {
    return this.db.transaction((tx) => {
      const rows = tx
        .select()
        .from(changeLog)
        .where(eq(changeLog.operationId, operationId))
        .orderBy(asc(changeLog.id))
        .all();
      const first = rows[0];
      if (!first) return { ok: false, reason: 'not_found' } as const;
      const contactId = first.contactId;
      if (rows.some((r) => r.contactId !== contactId)) {
        return { ok: false, reason: 'conflict', fields: ['contactId'] } as const;
      }
      const before = load(tx, contactId);
      if (!before) return { ok: false, reason: 'not_found' } as const;

      const earlier = tx
        .select({ id: changeLog.id })
        .from(changeLog)
        .where(and(eq(changeLog.contactId, contactId), lt(changeLog.id, first.id)))
        .limit(1)
        .get();
      const ts = ctx.now.toISOString();

      if (!earlier) {
        // First operation on the contact: it was the creation, so undoing it deletes the contact.
        if (before.deletedAt || before.version !== 1) {
          return { ok: false, reason: 'conflict', fields: ['version'] } as const;
        }
        tx.update(contact)
          .set({ deletedAt: ts, updatedAt: ts, version: before.version + 1 })
          .where(eq(contact.id, contactId))
          .run();
        const after = mustLoad(tx, contactId);
        logChanges(tx, ctx, contactId, before, after);
        return { ok: true, value: after } as const;
      }

      const current = (key: string): string => {
        const v =
          key === 'fields'
            ? before.fields.map(({ kind, label, value }) => ({ kind, label, value }))
            : before[key as keyof ContactView];
        return JSON.stringify(v ?? null);
      };
      const stale = rows.filter((r) => current(r.field) !== (r.after ?? 'null'));
      if (stale.length > 0) {
        return { ok: false, reason: 'conflict', fields: stale.map((r) => r.field) } as const;
      }

      const scalars: Record<string, unknown> = {};
      for (const r of rows) {
        const prior: unknown = r.before === null ? null : JSON.parse(r.before);
        if ((SCALARS as readonly string[]).includes(r.field)) {
          scalars[r.field] = r.field === 'noteMd' ? (prior ?? '') : prior;
        } else if (r.field === 'deletedAt') {
          scalars.deletedAt = prior;
        } else if (r.field === 'fields') {
          writeFields(tx, contactId, (prior ?? []) as z.infer<typeof fieldInput>[]);
        } else if (r.field === 'tags') {
          writeTags(tx, contactId, (prior ?? []) as string[]);
        } else if (r.field === 'custom') {
          writeCustom(tx, contactId, (prior ?? {}) as Record<string, string>);
        }
      }
      tx.update(contact)
        .set({ ...scalars, updatedAt: ts, version: before.version + 1 })
        .where(eq(contact.id, contactId))
        .run();
      const after = mustLoad(tx, contactId);
      logChanges(tx, ctx, contactId, before, after);
      return { ok: true, value: after } as const;
    });
  }
}
