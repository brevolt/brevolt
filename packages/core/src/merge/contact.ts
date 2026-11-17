import {
  isEmptyFieldsPatch,
  mergeFields,
  type FieldConflict,
  type FieldsPatch,
  type SnapshotField,
} from './fields.js';
import {
  mergeScalars,
  type ScalarConflict,
  type ScalarPatch,
  type ScalarSnapshot,
} from './scalar.js';

/** A contact as seen by one side: scalar fields plus optional multi-value fields. */
export type MergeSnapshot = ScalarSnapshot & { fields?: readonly SnapshotField[] };

export type MergePatch = ScalarPatch & { fields?: FieldsPatch };
export type MergeConflict = ScalarConflict | FieldConflict;

export interface MergeResult {
  hubPatch: MergePatch;
  externalPatch: MergePatch;
  conflicts: MergeConflict[];
  /**
   * The contact no longer exists in the external system. It is never deleted in the hub: the
   * caller flags it `deleted-upstream` and queues it in the inbox. Patches and conflicts are empty.
   */
  deletedUpstream: boolean;
}

/**
 * Pure three-way merge `merge(base, hub, external)` (R-SYNC-1): scalar fields field by field,
 * multi-value fields as sets keyed on `kind` + `normalized`. `external === null` means the
 * external system deleted the contact. No I/O, no mutation of inputs.
 */
export function merge(
  base: MergeSnapshot,
  hub: MergeSnapshot,
  external: MergeSnapshot | null,
): MergeResult {
  if (external === null) {
    return { hubPatch: {}, externalPatch: {}, conflicts: [], deletedUpstream: true };
  }
  const scalars = mergeScalars(base, hub, external);
  const fields = mergeFields(base.fields ?? [], hub.fields ?? [], external.fields ?? []);
  const hubPatch: MergePatch = { ...scalars.hubPatch };
  const externalPatch: MergePatch = { ...scalars.externalPatch };
  if (!isEmptyFieldsPatch(fields.hubPatch)) hubPatch.fields = fields.hubPatch;
  if (!isEmptyFieldsPatch(fields.externalPatch)) externalPatch.fields = fields.externalPatch;
  return {
    hubPatch,
    externalPatch,
    conflicts: [...scalars.conflicts, ...fields.conflicts],
    deletedUpstream: false,
  };
}
