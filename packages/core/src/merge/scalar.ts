import type { ContactSnapshot } from '@brevolt/contracts';

/** Scalar fields handled by the three-way merge (name parts, company, job title, birthday). */
export const SCALAR_FIELDS = [
  'prefix',
  'givenName',
  'middleName',
  'familyNames',
  'suffix',
  'nickname',
  'company',
  'jobTitle',
  'birthday',
] as const;

export type ScalarField = (typeof SCALAR_FIELDS)[number];
export type ScalarSnapshot = Pick<ContactSnapshot, ScalarField>;
export type ScalarPatch = Partial<ScalarSnapshot>;

export interface ScalarConflict<F extends ScalarField = ScalarField> {
  field: F;
  base: ScalarSnapshot[F];
  hub: ScalarSnapshot[F];
  external: ScalarSnapshot[F];
}

export interface ScalarMergeResult {
  /** Values to write to the hub (external changed, hub did not). */
  hubPatch: ScalarPatch;
  /** Values to send to the external system (hub changed, external did not). */
  externalPatch: ScalarPatch;
  /** Fields changed on both sides to different values: nothing is written anywhere. */
  conflicts: ScalarConflict[];
}

/**
 * Pure three-way merge of scalar fields (R-SYNC-1). Compares `base`, `hub` and `external`
 * field by field, following the merge table in docs/spec.md. No I/O, no mutation of inputs.
 * A field changed to the same value on both sides yields no patch (the caller updates the base).
 */
export function mergeScalars(
  base: ScalarSnapshot,
  hub: ScalarSnapshot,
  external: ScalarSnapshot,
): ScalarMergeResult {
  const hubPatch: Record<string, unknown> = {};
  const externalPatch: Record<string, unknown> = {};
  const conflicts: ScalarConflict[] = [];

  for (const field of SCALAR_FIELDS) {
    const b = base[field];
    const h = hub[field];
    const e = external[field];
    if (h === e) continue;
    if (h === b) hubPatch[field] = e;
    else if (e === b) externalPatch[field] = h;
    else conflicts.push({ field, base: b, hub: h, external: e });
  }

  return {
    hubPatch: hubPatch,
    externalPatch: externalPatch,
    conflicts,
  };
}

/** `merge(base, hub, external) → {hubPatch, externalPatch, conflicts}` for scalar fields. */
export const merge = mergeScalars;
