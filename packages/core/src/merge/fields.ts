import type { ContactSnapshot } from '@brevolt/contracts';

export type SnapshotField = ContactSnapshot['fields'][number];
export type FieldKey = Pick<SnapshotField, 'kind' | 'normalized'>;

/** Changes to apply to one side's multi-value fields (phones, emails, addresses, URLs). */
export interface FieldsPatch {
  /** Values missing on this side. */
  add: SnapshotField[];
  /** Values to remove from this side, identified by `kind` + `normalized`. */
  remove: FieldKey[];
  /** Same value, new label. */
  relabel: (FieldKey & { label: string })[];
}

/**
 * Conflict on one multi-value entry. Each side is the entry as it exists there, or `null` when
 * it is absent: label changed on both sides, added with different labels, or removed on one side
 * while the other changed its label.
 */
export interface FieldConflict {
  field: 'fields';
  kind: SnapshotField['kind'];
  normalized: string;
  base: SnapshotField | null;
  hub: SnapshotField | null;
  external: SnapshotField | null;
}

export interface FieldsMergeResult {
  hubPatch: FieldsPatch;
  externalPatch: FieldsPatch;
  conflicts: FieldConflict[];
}

const keyOf = (f: FieldKey): string => `${f.kind}\u0000${f.normalized}`;

function index(fields: readonly SnapshotField[]): Map<string, SnapshotField> {
  const map = new Map<string, SnapshotField>();
  for (const f of fields) if (!map.has(keyOf(f))) map.set(keyOf(f), f);
  return map;
}

/**
 * Three-way merge of multi-value fields as sets keyed on `kind` + `normalized`: additions and
 * removals from each side are combined; a label change on the same value is a field change.
 * Pure; output is sorted by key so it does not depend on input order or on which side is which.
 */
export function mergeFields(
  base: readonly SnapshotField[],
  hub: readonly SnapshotField[],
  external: readonly SnapshotField[],
): FieldsMergeResult {
  const b = index(base);
  const h = index(hub);
  const e = index(external);
  const keys = [...new Set([...b.keys(), ...h.keys(), ...e.keys()])].sort();

  const empty = (): FieldsPatch => ({ add: [], remove: [], relabel: [] });
  const hubPatch = empty();
  const externalPatch = empty();
  const conflicts: FieldConflict[] = [];

  for (const key of keys) {
    const bf = b.get(key);
    const hf = h.get(key);
    const ef = e.get(key);
    const ref = (hf ?? ef ?? bf) as SnapshotField;
    const conflict = (): void => {
      conflicts.push({
        field: 'fields',
        kind: ref.kind,
        normalized: ref.normalized,
        base: bf ?? null,
        hub: hf ?? null,
        external: ef ?? null,
      });
    };

    if (hf && ef) {
      if (hf.label === ef.label) continue;
      if (bf && hf.label === bf.label) {
        hubPatch.relabel.push({ kind: ef.kind, normalized: ef.normalized, label: ef.label });
      } else if (bf && ef.label === bf.label) {
        externalPatch.relabel.push({ kind: hf.kind, normalized: hf.normalized, label: hf.label });
      } else conflict();
    } else if (hf) {
      // Absent externally: a new hub value, or removed externally.
      if (!bf) externalPatch.add.push(hf);
      else if (hf.label === bf.label)
        hubPatch.remove.push({ kind: hf.kind, normalized: hf.normalized });
      else conflict();
    } else if (ef) {
      if (!bf) hubPatch.add.push(ef);
      else if (ef.label === bf.label)
        externalPatch.remove.push({ kind: ef.kind, normalized: ef.normalized });
      else conflict();
    }
    // Absent on both sides: added and removed everywhere, nothing to do.
  }

  return { hubPatch, externalPatch, conflicts };
}

export const isEmptyFieldsPatch = (p: FieldsPatch): boolean =>
  p.add.length === 0 && p.remove.length === 0 && p.relabel.length === 0;
