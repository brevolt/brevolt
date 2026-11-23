import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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
  externalLink,
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
import { isDryRun } from '../settings/dry-run.js';

/** The macOS bridge syncs one external system. */
const SYSTEM = 'icloud' as const;
/** An errored change is retried on later polls this many times, then left for the user. */
export const MAX_ATTEMPTS = 5;
const PAGE_SIZE = 100;

const EMPTY: ContactSnapshot = {
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

type SnapField = ContactSnapshot['fields'][number];
const keyOf = (f: { kind: string; normalized: string }): string => `${f.kind}\u0000${f.normalized}`;

function canonical(s: ContactSnapshot): ContactSnapshot {
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

function snapshotOfView(v: ContactView): ContactSnapshot {
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

function loadBase(tx: Tx, contactId: string): ContactSnapshot | null {
  const row = tx
    .select()
    .from(syncBase)
    .where(and(eq(syncBase.contactId, contactId), eq(syncBase.system, SYSTEM)))
    .get();
  return row ? contactSnapshotSchema.parse(JSON.parse(row.snapshot)) : null;
}

function saveBase(tx: Tx, contactId: string, snapshot: ContactSnapshot, now: Date): string {
  const snap = canonical(snapshot);
  const hash = hashSnapshot(snap);
  const values = { snapshot: JSON.stringify(snap), hash, syncedAt: now.toISOString() };
  tx.insert(syncBase)
    .values({ contactId, system: SYSTEM, ...values })
    .onConflictDoUpdate({ target: [syncBase.contactId, syncBase.system], set: values })
    .run();
  return hash;
}

function saveLink(tx: Tx, contactId: string, externalId: string, etag: string): void {
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

function applyHubPatch(
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

function recordConflicts(tx: Tx, contactId: string, conflicts: MergeResult['conflicts']): void {
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
function baseAfterIncoming(
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

interface PlannedChange {
  id: string;
  linkId: string | null;
  desired: { kind: 'upsert' | 'delete'; hash: string; payload: string | null } | null;
  snap: ContactSnapshot | null;
}

export interface DiffChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface DiffEntry {
  contact_id: string;
  action: 'create' | 'update' | 'delete';
  name: string;
  changes: DiffChange[];
}

function displayName(s: ContactSnapshot): string {
  const name = [s.givenName, s.familyNames].filter(Boolean).join(' ');
  return name || s.company || s.nickname || '(no name)';
}

function diffSnapshots(base: ContactSnapshot | null, next: ContactSnapshot): DiffChange[] {
  const out: DiffChange[] = [];
  for (const k of SCALAR_FIELDS) {
    const before = base ? (base[k]) : null;
    const after = next[k];
    if (before !== after) out.push({ field: k, before, after });
  }
  const was = new Map((base?.fields ?? []).map((f) => [keyOf(f), f]));
  const now = new Map(next.fields.map((f) => [keyOf(f), f]));
  for (const [k, f] of now) {
    const old = was.get(k);
    if (!old) out.push({ field: f.kind, before: null, after: f.value });
    else if (old.label !== f.label)
      out.push({ field: `${f.kind} label`, before: old.label, after: f.label });
  }
  for (const [k, f] of was)
    if (!now.has(k)) out.push({ field: f.kind, before: f.value, after: null });
  return out;
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
      if (!link) return { outcome: 'ignored', contactId: null };
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
      // Never deleted in the hub automatically: flagged for confirmation in the dashboard.
      const already = tx
        .select({ id: changeLog.id })
        .from(changeLog)
        .where(and(eq(changeLog.contactId, link.contactId), eq(changeLog.field, 'deletedUpstream')))
        .get();
      if (!already) {
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
      const created = service.create(
        {
          ...Object.fromEntries(SCALAR_FIELDS.map((k) => [k, ext[k]])),
          fields: ext.fields.map(({ kind, label, value }) => ({ kind, label, value })),
        },
        ctx,
      );
      const hash = saveBase(tx, created.id, snapshotOfView(created), ctx.now);
      saveLink(tx, created.id, change.local_id, hash);
      return { outcome: 'created', contactId: created.id };
    }

    const view = service.get(link.contactId);
    if (!view || view.deletedAt) return { outcome: 'ignored', contactId: link.contactId };
    const old = loadBase(tx, view.id) ?? EMPTY;
    const result = merge(old, snapshotOfView(view), ext);
    applyHubPatch(service, view, result.hubPatch, ctx);
    recordConflicts(tx, view.id, result.conflicts);
    const hash = saveBase(tx, view.id, baseAfterIncoming(old, ext, result.conflicts), ctx.now);
    tx.update(externalLink)
      .set({ etag: hash })
      .where(and(eq(externalLink.contactId, view.id), eq(externalLink.system, SYSTEM)))
      .run();
    const outcome: BridgeChangeOutcome =
      result.conflicts.length > 0
        ? 'conflict'
        : Object.keys(result.hubPatch).length > 0
          ? 'merged'
          : 'unchanged';
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
    // Dry-run (BRV-033): the bridge gets nothing and the queue is not even refreshed, so turning
    // dry-run off later starts from the current hub state, not from stale queued writes.
    if (isDryRun(this.db, SYSTEM)) return { changes: [], next: null };
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

  /** What the hub would send to the bridge right now: read-only, used by the queue and the diff. */
  private plan(tx: Tx): PlannedChange[] {
    const service = new ContactService(tx);
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
    const out: PlannedChange[] = [];
    const ids = tx.select({ id: contact.id, deletedAt: contact.deletedAt }).from(contact).all();
    for (const { id, deletedAt } of ids) {
      const linkId = links.get(id) ?? null;
      let desired: PlannedChange['desired'] = null;
      let snap: ContactSnapshot | null = null;
      if (!blocked.has(id)) {
        if (deletedAt) {
          if (linkId) desired = { kind: 'delete', hash: 'delete', payload: null };
        } else {
          const view = service.get(id);
          if (view) {
            snap = snapshotOfView(view);
            const hash = hashSnapshot(snap);
            if (!linkId || bases.get(id) !== hash) {
              desired = { kind: 'upsert', hash, payload: JSON.stringify(snap) };
            }
          }
        }
      }
      out.push({ id, linkId, desired, snap });
    }
    return out;
  }

  /**
   * Dry-run preview (BRV-033): everything the bridge would be asked to write, computed without
   * touching the queue, the bases or the links.
   */
  diff(): DiffEntry[] {
    return this.db.transaction((tx) => {
      const entries: DiffEntry[] = [];
      for (const p of this.plan(tx)) {
        if (!p.desired) continue;
        if (p.desired.kind === 'delete') {
          const base = loadBase(tx, p.id);
          entries.push({
            contact_id: p.id,
            action: 'delete',
            name: base ? displayName(base) : p.id,
            changes: [],
          });
          continue;
        }
        const next = p.snap ?? EMPTY;
        const base = p.linkId ? loadBase(tx, p.id) : null;
        entries.push({
          contact_id: p.id,
          action: p.linkId ? 'update' : 'create',
          name: displayName(next),
          changes: diffSnapshots(base, next),
        });
      }
      return entries;
    });
  }

  private refreshQueue(tx: Tx, clientId: string): void {
    const now = this.now().toISOString();
    const planned = this.plan(tx);
    const rows = tx
      .select()
      .from(bridgePending)
      .where(eq(bridgePending.clientId, clientId))
      .orderBy(bridgePending.seq)
      .all();
    const byContact = new Map<string, typeof rows>();
    for (const r of rows) byContact.set(r.contactId, [...(byContact.get(r.contactId) ?? []), r]);

    for (const { id, linkId, desired } of planned) {
      const history = byContact.get(id) ?? [];
      const open = history.filter((r) => r.status === 'pending' || r.status === 'error').at(-1);

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
