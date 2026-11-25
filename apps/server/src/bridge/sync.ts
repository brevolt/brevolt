import { createHash } from 'node:crypto';
import { and, asc, eq, isNull, notInArray } from 'drizzle-orm';
import {
  contactSnapshotSchema,
  type BridgeAckRequest,
  type BridgeAckResponse,
  type BridgeChangeOutcome,
  type BridgeContact,
  type BridgeIncomingChange,
  type BridgePendingChange,
  type ContactSnapshot,
} from '@brevolt/contracts';
import { SCALAR_FIELDS, merge, normalizeLabel, type MergeResult } from '@brevolt/core';
import type { HubDatabase } from '../db/index.js';
import {
  bridgeOperation,
  bridgePending,
  changeLog,
  conflict,
  contact,
  contactField,
  externalLink,
  proposal,
  syncBase,
} from '../db/schema.js';
import {
  ContactService,
  type Tx,
  normalizeValue,
  type ContactView,
  type WriteContext,
} from '../contacts/service.js';
import { uuidv7 } from '../contacts/uuid.js';

/** The macOS bridge syncs one external system. */
export const SYSTEM = 'icloud' as const;
/** An errored change is retried on later polls this many times, then left for the user. */
export const MAX_ATTEMPTS = 5;
const PAGE_SIZE = 100;

export const EMPTY: ContactSnapshot = {
  prefix: null,
  givenName: null,
  middleName: null,
  familyNames: null,
  suffix: null,
  nickname: null,
  company: null,
  jobTitle: null,
  birthday: null,
  fields: [],
};

export type SnapField = ContactSnapshot['fields'][number];
export const keyOf = (f: { kind: string; normalized: string }): string =>
  `${f.kind}\u0000${f.normalized}`;

export function canonical(s: ContactSnapshot): ContactSnapshot {
  const fields = [...s.fields].sort((a, b) =>
    keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0,
  );
  const out: Record<string, unknown> = {};
  for (const k of SCALAR_FIELDS) out[k] = s[k];
  out.fields = fields.map(({ kind, label, value, normalized }) => ({
    kind,
    label,
    value,
    normalized,
  }));
  return out as ContactSnapshot;
}

export function hashSnapshot(s: ContactSnapshot): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(s)))
    .digest('hex');
}

export function snapshotOfView(v: ContactView): ContactSnapshot {
  const scalars = Object.fromEntries(SCALAR_FIELDS.map((k) => [k, v[k]]));
  return canonical({
    ...(scalars as Omit<ContactSnapshot, 'fields'>),
    fields: v.fields.map(({ kind, label, value, normalized }) => ({
      kind: kind as SnapField['kind'],
      label,
      value,
      normalized,
    })),
  });
}

/** Normalizes what the Contacts app sent exactly as the hub normalizes its own writes. */
function snapshotOfIncoming(tx: Tx, c: BridgeContact): ContactSnapshot {
  const seen = new Set<string>();
  const fields: SnapField[] = [];
  for (const f of c.fields) {
    const value = f.value.trim();
    const entry = {
      kind: f.kind,
      label: normalizeLabel(f.label),
      value,
      normalized: normalizeValue(tx, f.kind, value),
    };
    if (seen.has(keyOf(entry))) continue;
    seen.add(keyOf(entry));
    fields.push(entry);
  }
  const scalars = Object.fromEntries(SCALAR_FIELDS.map((k) => [k, c[k]]));
  return canonical({ ...(scalars as Omit<ContactSnapshot, 'fields'>), fields });
}

function toBridgeContact(s: ContactSnapshot): BridgeContact {
  const scalars = Object.fromEntries(SCALAR_FIELDS.map((k) => [k, s[k]]));
  return {
    ...(scalars as Omit<BridgeContact, 'fields'>),
    fields: s.fields.map(({ kind, label, value }) => ({ kind, label, value })),
  };
}

export function loadBase(tx: Tx, contactId: string): ContactSnapshot | null {
  const row = tx
    .select()
    .from(syncBase)
    .where(and(eq(syncBase.contactId, contactId), eq(syncBase.system, SYSTEM)))
    .get();
  return row ? contactSnapshotSchema.parse(JSON.parse(row.snapshot)) : null;
}

export function saveBase(tx: Tx, contactId: string, snapshot: ContactSnapshot, now: Date): string {
  const snap = canonical(snapshot);
  const hash = hashSnapshot(snap);
  const values = { snapshot: JSON.stringify(snap), hash, syncedAt: now.toISOString() };
  tx.insert(syncBase)
    .values({ contactId, system: SYSTEM, ...values })
    .onConflictDoUpdate({ target: [syncBase.contactId, syncBase.system], set: values })
    .run();
  return hash;
}

export function saveLink(tx: Tx, contactId: string, externalId: string, etag: string): void {
  tx.delete(externalLink)
    .where(and(eq(externalLink.contactId, contactId), eq(externalLink.system, SYSTEM)))
    .run();
  tx.insert(externalLink).values({ contactId, system: SYSTEM, externalId, etag }).run();
}

function linkFor(tx: Tx, externalId: string) {
  return tx
    .select()
    .from(externalLink)
    .where(and(eq(externalLink.system, SYSTEM), eq(externalLink.externalId, externalId)))
    .get();
}

export function applyHubPatch(
  service: ContactService,
  view: ContactView,
  patch: MergeResult['hubPatch'],
  ctx: WriteContext,
): void {
  const input: Record<string, unknown> = {};
  for (const k of SCALAR_FIELDS) if (k in patch) input[k] = patch[k];
  if (patch.fields) {
    const drop = new Set([...patch.fields.remove.map(keyOf)]);
    const relabel = new Map(patch.fields.relabel.map((r) => [keyOf(r), r.label]));
    const kept = view.fields
      .filter((f) => !drop.has(keyOf(f)))
      .map((f) => ({
        kind: f.kind,
        label: relabel.get(keyOf(f)) ?? f.label,
        value: f.value,
      }));
    const added = patch.fields.add.map(({ kind, label, value }) => ({ kind, label, value }));
    input.fields = [...kept, ...added];
  }
  if (Object.keys(input).length === 0) return;
  const res = service.update(view.id, input, view.version, ctx);
  if (!res.ok) throw new Error(`Hub update failed: ${res.reason}`);
}

function conflictLabel(c: MergeResult['conflicts'][number]): string {
  return c.field === 'fields' ? `fields:${c.kind}:${c.normalized}` : c.field;
}

export function recordConflicts(
  tx: Tx,
  contactId: string,
  conflicts: MergeResult['conflicts'],
): void {
  for (const c of conflicts) {
    const field = conflictLabel(c);
    const values = {
      base: JSON.stringify(c.base ?? null),
      hubValue: JSON.stringify(c.hub ?? null),
      externalValue: JSON.stringify(c.external ?? null),
    };
    const open = tx
      .select()
      .from(conflict)
      .where(
        and(
          eq(conflict.contactId, contactId),
          eq(conflict.field, field),
          eq(conflict.system, SYSTEM),
          eq(conflict.status, 'pending'),
        ),
      )
      .get();
    if (open) tx.update(conflict).set(values).where(eq(conflict.id, open.id)).run();
    else {
      tx.insert(conflict)
        .values({ id: uuidv7(), contactId, field, system: SYSTEM, status: 'pending', ...values })
        .run();
    }
  }
}

/** Base after an external read: the external state, except entries still in conflict. */
export function baseAfterIncoming(
  old: ContactSnapshot,
  ext: ContactSnapshot,
  conflicts: MergeResult['conflicts'],
): ContactSnapshot {
  const next: ContactSnapshot = { ...ext, fields: [...ext.fields] };
  for (const c of conflicts) {
    if (c.field === 'fields') {
      const k = keyOf(c);
      next.fields = next.fields.filter((f) => keyOf(f) !== k);
      const prior = old.fields.find((f) => keyOf(f) === k);
      if (prior) next.fields.push(prior);
    } else {
      (next as Record<string, unknown>)[c.field] = old[c.field];
    }
  }
  return canonical(next);
}

/** Creates a hub contact from an external snapshot and links it; returns the new id. */
export function createFromExternal(
  tx: Tx,
  service: ContactService,
  ext: ContactSnapshot,
  localId: string,
  ctx: WriteContext,
): string {
  const created = service.create(
    {
      ...Object.fromEntries(SCALAR_FIELDS.map((k) => [k, ext[k]])),
      fields: ext.fields.map(({ kind, label, value }) => ({ kind, label, value })),
    },
    ctx,
  );
  const hash = saveBase(tx, created.id, snapshotOfView(created), ctx.now);
  saveLink(tx, created.id, localId, hash);
  return created.id;
}

/**
 * Three-way merge of an external snapshot into a linked hub contact: hub-side changes are applied,
 * conflicts are recorded (and left unwritten everywhere) and the base follows the external state.
 */
export function mergeExternal(
  tx: Tx,
  service: ContactService,
  view: ContactView,
  old: ContactSnapshot,
  ext: ContactSnapshot,
  ctx: WriteContext,
): BridgeChangeOutcome {
  const result = merge(old, snapshotOfView(view), ext);
  applyHubPatch(service, view, result.hubPatch, ctx);
  recordConflicts(tx, view.id, result.conflicts);
  const hash = saveBase(tx, view.id, baseAfterIncoming(old, ext, result.conflicts), ctx.now);
  tx.update(externalLink)
    .set({ etag: hash })
    .where(and(eq(externalLink.contactId, view.id), eq(externalLink.system, SYSTEM)))
    .run();
  return result.conflicts.length > 0
    ? 'conflict'
    : Object.keys(result.hubPatch).length > 0
      ? 'merged'
      : 'unchanged';
}

function pendingProposal(tx: Tx, type: 'merge' | 'deleted-upstream', contactId: string) {
  return tx
    .select()
    .from(proposal)
    .where(
      and(
        eq(proposal.type, type),
        eq(proposal.contactId, contactId),
        eq(proposal.system, SYSTEM),
        eq(proposal.status, 'pending'),
      ),
    )
    .get();
}

function pendingMergeFor(tx: Tx, localId: string) {
  return tx
    .select()
    .from(proposal)
    .where(
      and(
        eq(proposal.type, 'merge'),
        eq(proposal.system, SYSTEM),
        eq(proposal.externalId, localId),
        eq(proposal.status, 'pending'),
      ),
    )
    .get();
}

/**
 * Live hub contact, not yet linked to this system, sharing a normalized phone or email with the
 * incoming snapshot. The oldest one wins so the choice is deterministic.
 */
function findDuplicate(tx: Tx, ext: ContactSnapshot): { contactId: string; reason: string } | null {
  const keys = ext.fields.filter((f) => f.kind === 'phone' || f.kind === 'email');
  if (keys.length === 0) return null;
  const linked = tx
    .select({ id: externalLink.contactId })
    .from(externalLink)
    .where(eq(externalLink.system, SYSTEM));
  for (const k of keys) {
    const hit = tx
      .select({ id: contact.id })
      .from(contactField)
      .innerJoin(contact, eq(contact.id, contactField.contactId))
      .where(
        and(
          eq(contactField.kind, k.kind),
          eq(contactField.normalized, k.normalized),
          isNull(contact.deletedAt),
          notInArray(contact.id, linked),
        ),
      )
      .orderBy(asc(contact.createdAt), asc(contact.id))
      .get();
    if (hit) return { contactId: hit.id, reason: `${k.kind}:${k.normalized}` };
  }
  return null;
}

export interface ChangeResult {
  operation_id: string;
  outcome: BridgeChangeOutcome;
  contact_id: string | null;
}

export class BridgeSync {
  constructor(
    private readonly db: HubDatabase,
    private readonly now: () => Date,
  ) {}

  /** `POST /v1/bridge/changes`: each change is atomic and idempotent by `operation_id`. */
  receiveChanges(clientId: string, changes: BridgeIncomingChange[]): ChangeResult[] {
    return changes.map((c) => this.receiveOne(clientId, c));
  }

  private receiveOne(clientId: string, change: BridgeIncomingChange): ChangeResult {
    return this.db.transaction((tx) => {
      const seen = tx
        .select()
        .from(bridgeOperation)
        .where(
          and(
            eq(bridgeOperation.clientId, clientId),
            eq(bridgeOperation.operationId, change.operation_id),
          ),
        )
        .get();
      if (seen) {
        return {
          operation_id: change.operation_id,
          outcome: 'duplicate' as const,
          contact_id: seen.contactId,
        };
      }
      const now = this.now();
      const ctx: WriteContext = {
        actor: `client:${clientId}`,
        operationId: change.operation_id,
        now,
      };
      const { outcome, contactId } = this.process(tx, change, ctx);
      tx.insert(bridgeOperation)
        .values({
          clientId,
          operationId: change.operation_id,
          outcome,
          contactId,
          createdAt: now.toISOString(),
        })
        .run();
      return { operation_id: change.operation_id, outcome, contact_id: contactId };
    });
  }

  private process(
    tx: Tx,
    change: BridgeIncomingChange,
    ctx: WriteContext,
  ): { outcome: BridgeChangeOutcome; contactId: string | null } {
    const service = new ContactService(tx);
    const link = linkFor(tx, change.local_id);

    if (change.kind === 'delete') {
      if (!link) {
        const open = pendingMergeFor(tx, change.local_id);
        if (open) {
          tx.update(proposal)
            .set({ status: 'withdrawn', resolvedAt: ctx.now.toISOString() })
            .where(eq(proposal.id, open.id))
            .run();
        }
        return { outcome: 'ignored', contactId: null };
      }
      const view = service.get(link.contactId);
      if (!view || view.deletedAt) {
        // The hub already deleted it (this is the echo of our own delete): drop the link.
        tx.delete(externalLink)
          .where(and(eq(externalLink.contactId, link.contactId), eq(externalLink.system, SYSTEM)))
          .run();
        tx.delete(syncBase)
          .where(and(eq(syncBase.contactId, link.contactId), eq(syncBase.system, SYSTEM)))
          .run();
        return { outcome: 'unchanged', contactId: link.contactId };
      }
      // Never deleted in the hub automatically: a proposal waits for confirmation in the dashboard.
      const already = pendingProposal(tx, 'deleted-upstream', link.contactId);
      if (!already) {
        tx.insert(proposal)
          .values({
            id: uuidv7(),
            type: 'deleted-upstream',
            system: SYSTEM,
            contactId: link.contactId,
            createdAt: ctx.now.toISOString(),
          })
          .run();
        tx.insert(changeLog)
          .values({
            ts: ctx.now.toISOString(),
            actor: ctx.actor,
            contactId: link.contactId,
            field: 'deletedUpstream',
            before: null,
            after: JSON.stringify(SYSTEM),
            operationId: ctx.operationId,
          })
          .run();
      }
      return { outcome: 'deleted_upstream', contactId: link.contactId };
    }

    const ext = snapshotOfIncoming(tx, change.contact ?? { ...EMPTY });

    if (!link) {
      const open = pendingMergeFor(tx, change.local_id);
      if (open) {
        tx.update(proposal)
          .set({ externalSnapshot: JSON.stringify(ext) })
          .where(eq(proposal.id, open.id))
          .run();
        return { outcome: 'proposal', contactId: open.contactId };
      }
      // Never merged automatically: a match by normalized phone or email becomes a proposal.
      const match = findDuplicate(tx, ext);
      if (match) {
        tx.insert(proposal)
          .values({
            id: uuidv7(),
            type: 'merge',
            system: SYSTEM,
            contactId: match.contactId,
            externalId: change.local_id,
            externalSnapshot: JSON.stringify(ext),
            reason: match.reason,
            createdAt: ctx.now.toISOString(),
          })
          .run();
        return { outcome: 'proposal', contactId: match.contactId };
      }
      const created = createFromExternal(tx, service, ext, change.local_id, ctx);
      return { outcome: 'created', contactId: created };
    }

    const view = service.get(link.contactId);
    if (!view || view.deletedAt) return { outcome: 'ignored', contactId: link.contactId };
    // It exists externally after all: a pending "deleted upstream" no longer holds.
    tx.update(proposal)
      .set({ status: 'withdrawn', resolvedAt: ctx.now.toISOString() })
      .where(
        and(
          eq(proposal.contactId, view.id),
          eq(proposal.type, 'deleted-upstream'),
          eq(proposal.status, 'pending'),
        ),
      )
      .run();
    const outcome = mergeExternal(tx, service, view, loadBase(tx, view.id) ?? EMPTY, ext, ctx);
    return { outcome, contactId: view.id };
  }

  /**
   * Brings the client's queue up to date with the hub (hub snapshot vs `sync_base`) and returns
   * one page of unacknowledged changes. Because the base is updated whenever a change arrives from
   * or is acknowledged by the bridge, a client never gets its own changes back.
   */
  pending(
    clientId: string,
    cursor: number,
  ): { changes: BridgePendingChange[]; next: string | null } {
    this.db.transaction((tx) => {
      this.refreshQueue(tx, clientId);
    });
    const rows = this.db
      .select()
      .from(bridgePending)
      .where(and(eq(bridgePending.clientId, clientId), eq(bridgePending.status, 'pending')))
      .orderBy(bridgePending.seq)
      .all()
      .filter((r) => r.seq > cursor);
    const page = rows.slice(0, PAGE_SIZE);
    const changes = page.map((r): BridgePendingChange => {
      const base = {
        operation_id: r.operationId,
        contact_id: r.contactId,
        local_id: r.localId,
        kind: r.kind,
      };
      return r.kind === 'delete' || !r.payload
        ? base
        : {
            ...base,
            contact: toBridgeContact(contactSnapshotSchema.parse(JSON.parse(r.payload))),
          };
    });
    const last = page.at(-1);
    return { changes, next: rows.length > page.length && last ? String(last.seq) : null };
  }

  private refreshQueue(tx: Tx, clientId: string): void {
    const service = new ContactService(tx);
    const now = this.now().toISOString();
    const links = new Map(
      tx
        .select()
        .from(externalLink)
        .where(eq(externalLink.system, SYSTEM))
        .all()
        .map((l) => [l.contactId, l.externalId]),
    );
    const bases = new Map(
      tx
        .select({ contactId: syncBase.contactId, hash: syncBase.hash })
        .from(syncBase)
        .where(eq(syncBase.system, SYSTEM))
        .all()
        .map((b) => [b.contactId, b.hash]),
    );
    const blocked = new Set(
      tx
        .select({ contactId: conflict.contactId })
        .from(conflict)
        .where(and(eq(conflict.system, SYSTEM), eq(conflict.status, 'pending')))
        .all()
        .map((c) => c.contactId),
    );
    // A pending deletion or merge decision holds the contact back: pushing it now would recreate
    // the deleted card, or duplicate the one it may be merged with.
    for (const p of tx
      .select({ contactId: proposal.contactId })
      .from(proposal)
      .where(and(eq(proposal.system, SYSTEM), eq(proposal.status, 'pending')))
      .all()) {
      blocked.add(p.contactId);
    }
    const rows = tx
      .select()
      .from(bridgePending)
      .where(eq(bridgePending.clientId, clientId))
      .orderBy(bridgePending.seq)
      .all();
    const byContact = new Map<string, typeof rows>();
    for (const r of rows) byContact.set(r.contactId, [...(byContact.get(r.contactId) ?? []), r]);

    const ids = tx.select({ id: contact.id, deletedAt: contact.deletedAt }).from(contact).all();
    for (const { id, deletedAt } of ids) {
      const history = byContact.get(id) ?? [];
      const open = history.filter((r) => r.status === 'pending' || r.status === 'error').at(-1);
      const linkId = links.get(id) ?? null;

      let desired: { kind: 'upsert' | 'delete'; hash: string; payload: string | null } | null =
        null;
      if (!blocked.has(id)) {
        if (deletedAt) {
          if (linkId) desired = { kind: 'delete', hash: 'delete', payload: null };
        } else {
          const view = service.get(id);
          if (view) {
            const snap = snapshotOfView(view);
            const hash = hashSnapshot(snap);
            if (!linkId || bases.get(id) !== hash) {
              desired = { kind: 'upsert', hash, payload: JSON.stringify(snap) };
            }
          }
        }
      }

      if (open && desired && open.kind === desired.kind && open.hash === desired.hash) {
        if (open.status === 'error' && open.attempts < MAX_ATTEMPTS) {
          tx.update(bridgePending)
            .set({ status: 'pending' })
            .where(eq(bridgePending.seq, open.seq))
            .run();
        }
        continue;
      }
      if (open) {
        tx.update(bridgePending)
          .set({ status: 'superseded' })
          .where(eq(bridgePending.seq, open.seq))
          .run();
      }
      if (!desired) continue;
      tx.insert(bridgePending)
        .values({
          clientId,
          operationId: `pend:${id}:${desired.hash.slice(0, 12)}:${String(history.length + 1)}`,
          contactId: id,
          kind: desired.kind,
          localId: linkId,
          payload: desired.payload,
          hash: desired.hash,
          createdAt: now,
        })
        .run();
    }
  }

  /** `POST /v1/bridge/ack`: each ack is its own transaction so one bad change blocks nothing. */
  ack(clientId: string, acks: BridgeAckRequest['acks']): BridgeAckResponse['results'] {
    return acks.map((a) => ({
      operation_id: a.operation_id,
      result: this.db.transaction((tx) => this.ackOne(tx, clientId, a)),
    }));
  }

  private ackOne(
    tx: Tx,
    clientId: string,
    a: BridgeAckRequest['acks'][number],
  ): BridgeAckResponse['results'][number]['result'] {
    const row = tx
      .select()
      .from(bridgePending)
      .where(
        and(eq(bridgePending.clientId, clientId), eq(bridgePending.operationId, a.operation_id)),
      )
      .get();
    if (!row) return 'unknown';
    if (row.status === 'acked') return 'duplicate';
    if (row.status === 'superseded') return 'rejected';
    const now = this.now().toISOString();

    const fail = (message: string) => {
      tx.update(bridgePending)
        .set({ status: 'error', error: message.slice(0, 2000), attempts: row.attempts + 1 })
        .where(eq(bridgePending.seq, row.seq))
        .run();
    };
    if (a.status === 'error') {
      fail(a.error ?? 'unknown error');
      return 'error_recorded';
    }

    // R-SYNC-2: base and link move together, in this same transaction.
    if (row.kind === 'delete') {
      tx.delete(externalLink)
        .where(and(eq(externalLink.contactId, row.contactId), eq(externalLink.system, SYSTEM)))
        .run();
      tx.delete(syncBase)
        .where(and(eq(syncBase.contactId, row.contactId), eq(syncBase.system, SYSTEM)))
        .run();
    } else {
      const localId = a.local_id ?? row.localId;
      if (!localId) {
        fail('ack without local_id for a new contact');
        return 'rejected';
      }
      const owner = linkFor(tx, localId);
      if (owner && owner.contactId !== row.contactId) {
        fail('local_id already linked to another contact');
        return 'rejected';
      }
      const snapshot = contactSnapshotSchema.parse(JSON.parse(row.payload ?? '{}'));
      const hash = saveBase(tx, row.contactId, snapshot, this.now());
      saveLink(tx, row.contactId, localId, hash);
    }
    tx.update(bridgePending)
      .set({ status: 'acked', error: null, ackedAt: now })
      .where(eq(bridgePending.seq, row.seq))
      .run();
    return 'applied';
  }
}
