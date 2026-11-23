import { and, desc, eq } from 'drizzle-orm';
import { birthdaySchema, contactSnapshotSchema, type ContactSnapshot } from '@brevolt/contracts';
import { SCALAR_FIELDS, normalizeLabel } from '@brevolt/core';
import type { HubDatabase } from '../db/index.js';
import { conflict, contact, externalLink, proposal, syncBase } from '../db/schema.js';
import { ContactService, normalizeValue, type Tx, type WriteContext } from '../contacts/service.js';
import {
  EMPTY,
  createFromExternal,
  keyOf,
  loadBase,
  mergeExternal,
  saveBase,
  saveLink,
  snapshotOfView,
  type SnapField,
} from './sync.js';
import { z } from 'zod';

export const resolveConflictSchema = z.discriminatedUnion('resolution', [
  z.strictObject({ resolution: z.literal('hub') }),
  z.strictObject({ resolution: z.literal('external') }),
  /** `value`: a string/null for a scalar field; `{label, value}` or null (remove) for a list entry. */
  z.strictObject({ resolution: z.literal('manual'), value: z.unknown() }),
]);
export type ResolveConflictInput = z.infer<typeof resolveConflictSchema>;

const manualEntry = z.strictObject({
  label: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(2000),
});

export type DecisionError =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'already_resolved' }
  | { ok: false; reason: 'invalid_value'; message: string }
  | { ok: false; reason: 'stale'; message: string };
export type DecisionResult<T> = { ok: true; value: T } | DecisionError;

const parse = (v: string | null): unknown => (v === null ? null : JSON.parse(v));
const summary = (c: {
  id: string;
  givenName: string | null;
  familyNames: string | null;
  company: string | null;
}) => ({
  id: c.id,
  givenName: c.givenName,
  familyNames: c.familyNames,
  company: c.company,
});

/** Splits `fields:<kind>:<normalized>`; the normalized part may itself contain colons. */
function parseFieldLabel(field: string): { kind: SnapField['kind']; normalized: string } | null {
  const m = /^fields:(phone|email|address|url):(.*)$/s.exec(field);
  return m ? { kind: m[1] as SnapField['kind'], normalized: m[2] ?? '' } : null;
}

/**
 * Dashboard-only decisions (R-SYNC-4): resolving conflicts and accepting or rejecting merge and
 * deletion proposals. The chosen value goes into the hub; every linked system then receives it
 * through its own queue (hub snapshot vs `sync_base`), so one resolution reaches all of them.
 */
export class Decisions {
  constructor(private readonly db: HubDatabase) {}

  listConflicts(status: 'pending' | 'resolved' | 'all' = 'pending') {
    const rows = this.db
      .select({ c: conflict, p: contact })
      .from(conflict)
      .innerJoin(contact, eq(contact.id, conflict.contactId))
      .where(status === 'all' ? undefined : eq(conflict.status, status))
      .orderBy(desc(conflict.id))
      .all();
    return rows.map(({ c, p }) => ({
      id: c.id,
      contact: summary(p),
      field: c.field,
      system: c.system,
      base: parse(c.base),
      hubValue: parse(c.hubValue),
      externalValue: parse(c.externalValue),
      status: c.status,
      resolution: c.resolution,
      resolvedValue: parse(c.resolvedValue),
      resolvedAt: c.resolvedAt,
    }));
  }

  listProposals(status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'all' = 'pending') {
    const rows = this.db
      .select({ r: proposal, p: contact })
      .from(proposal)
      .innerJoin(contact, eq(contact.id, proposal.contactId))
      .where(status === 'all' ? undefined : eq(proposal.status, status))
      .orderBy(desc(proposal.id))
      .all();
    const service = new ContactService(this.db);
    return rows.map(({ r, p }) => ({
      id: r.id,
      type: r.type,
      system: r.system,
      contact: summary(p),
      hub: r.type === 'merge' ? snapshotOrNull(service, p.id) : null,
      external: r.externalSnapshot ? (JSON.parse(r.externalSnapshot) as ContactSnapshot) : null,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    }));
  }

  resolveConflict(
    id: string,
    input: ResolveConflictInput,
    ctx: WriteContext,
  ): DecisionResult<{ id: string; resolution: string; value: unknown }> {
    return this.db.transaction((tx) => {
      const row = tx.select().from(conflict).where(eq(conflict.id, id)).get();
      if (!row) return { ok: false, reason: 'not_found' } as const;
      if (row.status !== 'pending') return { ok: false, reason: 'already_resolved' } as const;
      const service = new ContactService(tx);
      const view = service.get(row.contactId);
      const nowIso = ctx.now.toISOString();
      const done = (value: unknown) => {
        tx.update(conflict)
          .set({
            status: 'resolved',
            resolution: input.resolution,
            resolvedValue: JSON.stringify(value ?? null),
            resolvedAt: nowIso,
          })
          .where(eq(conflict.id, id))
          .run();
        return {
          ok: true,
          value: { id, resolution: input.resolution, value: value ?? null },
        } as const;
      };
      // The contact was deleted meanwhile: nothing left to write.
      if (!view || view.deletedAt) return done(null);

      const entry = parseFieldLabel(row.field);
      const scalar = (SCALAR_FIELDS as readonly string[]).includes(row.field)
        ? (row.field as (typeof SCALAR_FIELDS)[number])
        : null;
      if (!entry && !scalar) {
        return {
          ok: false,
          reason: 'invalid_value',
          message: `Unknown field ${row.field}`,
        } as const;
      }

      const entryKey = entry ? keyOf(entry) : '';
      const hubSnap = snapshotOfView(view);
      let chosen: unknown;
      if (input.resolution === 'hub') {
        chosen = scalar
          ? hubSnap[scalar]
          : (hubSnap.fields.find((f) => keyOf(f) === entryKey) ?? null);
      } else if (input.resolution === 'external') {
        chosen = parse(row.externalValue);
      } else {
        const v = validateManual(tx, scalar, entry, input.value);
        if (!v.ok) return v;
        chosen = v.value;
      }

      // 1. Hub gets the chosen value (a no-op for `hub`).
      if (scalar) {
        if (input.resolution !== 'hub') {
          const res = service.update(view.id, { [scalar]: chosen }, view.version, ctx);
          if (!res.ok)
            return { ok: false, reason: 'stale', message: 'Contact changed; retry' } as const;
        }
      } else if (input.resolution !== 'hub') {
        const k = entryKey;
        const kept = view.fields
          .filter((f) => keyOf(f) !== k)
          .map((f) => ({ kind: f.kind, label: f.label, value: f.value }));
        const next = chosen as SnapField | null;
        const fields = next
          ? [...kept, { kind: next.kind, label: next.label, value: next.value }]
          : kept;
        const res = service.update(view.id, { fields } as never, view.version, ctx);
        if (!res.ok)
          return { ok: false, reason: 'stale', message: 'Contact changed; retry' } as const;
      }

      // 2. With `external` the system already holds this value: move its base so nothing echoes
      // back. For `hub` and `manual` the base keeps the old value, so the queue pushes the hub's.
      if (input.resolution === 'external') {
        const base = loadBase(tx, view.id);
        if (base) {
          const next: ContactSnapshot = { ...base, fields: [...base.fields] };
          if (scalar) (next as Record<string, unknown>)[scalar] = chosen;
          else {
            next.fields = next.fields.filter((f) => keyOf(f) !== entryKey);
            if (chosen) next.fields.push(chosen as SnapField);
          }
          saveBase(tx, view.id, next, ctx.now);
        }
      }
      return done(chosen);
    });
  }

  acceptProposal(id: string, ctx: WriteContext): DecisionResult<{ id: string; contactId: string }> {
    return this.db.transaction((tx) => {
      const row = tx.select().from(proposal).where(eq(proposal.id, id)).get();
      if (!row) return { ok: false, reason: 'not_found' } as const;
      if (row.status !== 'pending') return { ok: false, reason: 'already_resolved' } as const;
      const service = new ContactService(tx);
      const view = service.get(row.contactId);
      const close = (status: 'accepted' | 'rejected' | 'withdrawn') =>
        tx
          .update(proposal)
          .set({ status, resolvedAt: ctx.now.toISOString() })
          .where(eq(proposal.id, id))
          .run();

      if (row.type === 'deleted-upstream') {
        // Soft delete in the hub; the other systems get the delete from their queues. The system
        // that reported it already lacks the contact, so its link and base are dropped.
        if (view && !view.deletedAt) {
          const res = service.remove(view.id, null, ctx);
          if (!res.ok)
            return { ok: false, reason: 'stale', message: 'Contact changed; retry' } as const;
        }
        unlink(tx, row.contactId, row.system);
        close('accepted');
        return { ok: true, value: { id, contactId: row.contactId } } as const;
      }

      if (!row.externalId || !row.externalSnapshot) {
        return {
          ok: false,
          reason: 'invalid_value',
          message: 'Proposal has no external record',
        } as const;
      }
      if (!view || view.deletedAt) {
        return {
          ok: false,
          reason: 'stale',
          message: 'Target contact no longer exists; reject it instead',
        } as const;
      }
      const taken = tx
        .select()
        .from(externalLink)
        .where(
          and(eq(externalLink.system, row.system), eq(externalLink.externalId, row.externalId)),
        )
        .get();
      const mine = tx
        .select()
        .from(externalLink)
        .where(and(eq(externalLink.contactId, view.id), eq(externalLink.system, row.system)))
        .get();
      if (taken || mine) {
        return { ok: false, reason: 'stale', message: 'Already linked to this system' } as const;
      }
      const ext = contactSnapshotSchema.parse(JSON.parse(row.externalSnapshot));
      // Link it and merge against an empty base: values only one side has are combined, values
      // that differ become conflicts. Nothing is merged without this explicit accept.
      saveLink(tx, view.id, row.externalId, '');
      mergeExternal(tx, service, view, EMPTY, ext, ctx);
      close('accepted');
      return { ok: true, value: { id, contactId: view.id } } as const;
    });
  }

  rejectProposal(id: string, ctx: WriteContext): DecisionResult<{ id: string; contactId: string }> {
    return this.db.transaction((tx) => {
      const row = tx.select().from(proposal).where(eq(proposal.id, id)).get();
      if (!row) return { ok: false, reason: 'not_found' } as const;
      if (row.status !== 'pending') return { ok: false, reason: 'already_resolved' } as const;
      const service = new ContactService(tx);
      let contactId = row.contactId;
      if (row.type === 'deleted-upstream') {
        // Keep the contact: dropping the link makes the queue recreate it in that system.
        unlink(tx, row.contactId, row.system);
      } else if (row.externalId && row.externalSnapshot) {
        // Not a duplicate after all: it becomes its own contact.
        contactId = createFromExternal(
          tx,
          service,
          contactSnapshotSchema.parse(JSON.parse(row.externalSnapshot)),
          row.externalId,
          ctx,
        );
      }
      tx.update(proposal)
        .set({ status: 'rejected', resolvedAt: ctx.now.toISOString() })
        .where(eq(proposal.id, id))
        .run();
      return { ok: true, value: { id, contactId } } as const;
    });
  }
}

function unlink(tx: Tx, contactId: string, system: 'icloud' | 'google' | 'obsidian'): void {
  tx.delete(externalLink)
    .where(and(eq(externalLink.contactId, contactId), eq(externalLink.system, system)))
    .run();
  tx.delete(syncBase)
    .where(and(eq(syncBase.contactId, contactId), eq(syncBase.system, system)))
    .run();
}

function snapshotOrNull(service: ContactService, id: string): ContactSnapshot | null {
  const v = service.get(id);
  return v ? snapshotOfView(v) : null;
}

function validateManual(
  tx: Tx,
  scalar: string | null,
  entry: { kind: SnapField['kind']; normalized: string } | null,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; reason: 'invalid_value'; message: string } {
  const bad = (message: string) => ({ ok: false, reason: 'invalid_value', message }) as const;
  if (scalar) {
    if (value === null) return { ok: true, value: null };
    if (typeof value !== 'string') return bad('Expected a string or null');
    const text = value.trim() === '' ? null : value.trim();
    if (scalar === 'birthday' && text !== null && !birthdaySchema.safeParse(text).success) {
      return bad('Invalid birthday');
    }
    return { ok: true, value: text };
  }
  if (value === null) return { ok: true, value: null };
  const parsed = manualEntry.safeParse(value);
  if (!parsed.success) return bad('Expected {label, value} or null');
  if (!entry) return bad('Unknown field');
  const kind = entry.kind;
  const v = parsed.data.value;
  return {
    ok: true,
    value: {
      kind,
      label: normalizeLabel(parsed.data.label),
      value: v,
      normalized: normalizeValue(tx, kind, v),
    },
  };
}
