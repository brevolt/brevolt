import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { merge, type FieldsPatch, type MergeSnapshot, type SnapshotField } from '../src/index.js';

const scalars = {
  prefix: null,
  givenName: 'Ana',
  middleName: null,
  familyNames: null,
  suffix: null,
  nickname: null,
  company: null,
  jobTitle: null,
  birthday: null,
};
const snap = (fields: SnapshotField[]): MergeSnapshot => ({ ...scalars, fields });
const f = (kind: SnapshotField['kind'], normalized: string, label = 'mobile'): SnapshotField => ({
  kind,
  label,
  value: normalized,
  normalized,
});

const phoneA = f('phone', '+34600000001');
const phoneB = f('phone', '+34600000002', 'work');
const mailA = f('email', 'ana@example.com', 'home');

describe('merge multi-value fields: fixtures', () => {
  it('combines crossed additions from both sides', () => {
    const r = merge(snap([phoneA]), snap([phoneA, phoneB]), snap([phoneA, mailA]));
    expect(r.hubPatch.fields).toEqual({ add: [mailA], remove: [], relabel: [] });
    expect(r.externalPatch.fields).toEqual({ add: [phoneB], remove: [], relabel: [] });
    expect(r.conflicts).toEqual([]);
  });

  it('combines crossed removals from both sides', () => {
    const r = merge(snap([phoneA, phoneB, mailA]), snap([phoneA, phoneB]), snap([phoneA, mailA]));
    expect(r.hubPatch.fields).toEqual({
      add: [],
      remove: [{ kind: 'phone', normalized: phoneB.normalized }],
      relabel: [],
    });
    expect(r.externalPatch.fields).toEqual({
      add: [],
      remove: [{ kind: 'email', normalized: mailA.normalized }],
      relabel: [],
    });
  });

  it('an addition on one side and a removal on the other both apply', () => {
    const r = merge(snap([phoneA]), snap([]), snap([phoneA, phoneB]));
    expect(r.hubPatch.fields).toEqual({ add: [phoneB], remove: [], relabel: [] });
    expect(r.externalPatch.fields).toEqual({
      add: [],
      remove: [{ kind: 'phone', normalized: phoneA.normalized }],
      relabel: [],
    });
  });

  it('the same value added or removed on both sides is a no-op', () => {
    expect(merge(snap([]), snap([phoneA]), snap([phoneA]))).toMatchObject({
      hubPatch: {},
      externalPatch: {},
      conflicts: [],
    });
    expect(merge(snap([phoneA]), snap([]), snap([]))).toMatchObject({
      hubPatch: {},
      externalPatch: {},
      conflicts: [],
    });
  });

  it('keys on kind + normalized: same normalized under another kind is a different entry', () => {
    const url = f('url', 'x');
    const addr = f('address', 'x');
    const r = merge(snap([url]), snap([url, addr]), snap([url]));
    expect(r.externalPatch.fields?.add).toEqual([addr]);
  });

  it('label change on one side propagates to the other', () => {
    const relabeled = { ...phoneA, label: 'work' };
    const fromHub = merge(snap([phoneA]), snap([relabeled]), snap([phoneA]));
    expect(fromHub.externalPatch.fields).toEqual({
      add: [],
      remove: [],
      relabel: [{ kind: 'phone', normalized: phoneA.normalized, label: 'work' }],
    });
    const fromExt = merge(snap([phoneA]), snap([phoneA]), snap([relabeled]));
    expect(fromExt.hubPatch.fields?.relabel).toEqual([
      { kind: 'phone', normalized: phoneA.normalized, label: 'work' },
    ]);
  });

  it('label changed to the same value on both sides is a no-op', () => {
    const relabeled = { ...phoneA, label: 'work' };
    expect(merge(snap([phoneA]), snap([relabeled]), snap([relabeled])).conflicts).toEqual([]);
  });

  it('label changed differently on both sides is a conflict, nothing written', () => {
    const h = { ...phoneA, label: 'work' };
    const e = { ...phoneA, label: 'home' };
    const r = merge(snap([phoneA]), snap([h]), snap([e]));
    expect(r.hubPatch).toEqual({});
    expect(r.externalPatch).toEqual({});
    expect(r.conflicts).toEqual([
      {
        field: 'fields',
        kind: 'phone',
        normalized: phoneA.normalized,
        base: phoneA,
        hub: h,
        external: e,
      },
    ]);
  });

  it('removal on one side vs label change on the other is a conflict', () => {
    const h = { ...phoneA, label: 'work' };
    const r = merge(snap([phoneA]), snap([h]), snap([]));
    expect(r.conflicts).toEqual([
      {
        field: 'fields',
        kind: 'phone',
        normalized: phoneA.normalized,
        base: phoneA,
        hub: h,
        external: null,
      },
    ]);
    expect(r.hubPatch).toEqual({});
  });

  it('same value added on both sides with different labels is a conflict', () => {
    const e = { ...phoneA, label: 'home' };
    const r = merge(snap([]), snap([phoneA]), snap([e]));
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ base: null, hub: phoneA, external: e });
  });

  it('scalars and fields merge together; absent `fields` counts as empty', () => {
    const r = merge(snap([phoneA]), { ...snap([phoneA]), company: 'Hub' }, snap([phoneA, mailA]));
    expect(r.externalPatch).toEqual({ company: 'Hub' });
    expect(r.hubPatch.fields?.add).toEqual([mailA]);
    expect(merge(scalars, scalars, scalars).conflicts).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const b = Object.freeze(snap(Object.freeze([phoneA]) as SnapshotField[]));
    const h = Object.freeze(snap(Object.freeze([phoneA, phoneB]) as SnapshotField[]));
    expect(() => merge(b, h, b)).not.toThrow();
  });
});

describe('merge contact deletion', () => {
  it('an external deletion yields deletedUpstream and never a patch or direct delete', () => {
    const r = merge(snap([phoneA]), { ...snap([phoneA, phoneB]), company: 'Hub' }, null);
    expect(r).toEqual({ hubPatch: {}, externalPatch: {}, conflicts: [], deletedUpstream: true });
  });

  it('is false whenever the external contact exists', () => {
    expect(merge(snap([]), snap([]), snap([])).deletedUpstream).toBe(false);
  });
});

const apply = (fields: readonly SnapshotField[], p?: FieldsPatch): SnapshotField[] => {
  if (!p) return [...fields];
  const k = (x: { kind: string; normalized: string }): string => `${x.kind}|${x.normalized}`;
  const removed = new Set(p.remove.map(k));
  const relabel = new Map(p.relabel.map((x) => [k(x), x.label]));
  return [
    ...fields
      .filter((x) => !removed.has(k(x)))
      .map((x) => ({ ...x, label: relabel.get(k(x)) ?? x.label })),
    ...p.add,
  ];
};
const norm = (fs: readonly SnapshotField[]): string[] =>
  fs.map((x) => `${x.kind}|${x.normalized}|${x.label}`).sort();

const entry = fc
  .record({
    kind: fc.constantFrom('phone', 'email', 'url'),
    normalized: fc.constantFrom('a', 'b', 'c'),
    label: fc.constantFrom('mobile', 'work'),
  })
  .map((x) => ({ ...x, value: x.normalized }));
const fieldSet = fc
  .array(entry, { maxLength: 6 })
  .map((xs) => [...new Map(xs.map((x) => [`${x.kind}|${x.normalized}`, x])).values()]);
const runs = { numRuns: 1000 };

describe('merge multi-value fields: properties (1000 runs)', () => {
  it('idempotence: re-merging after applying the patches yields no changes', () => {
    fc.assert(
      fc.property(fieldSet, fieldSet, fieldSet, (b, h, e) => {
        const r = merge(snap(b), snap(h), snap(e));
        const h2 = apply(h, r.hubPatch.fields);
        const e2 = apply(e, r.externalPatch.fields);
        const again = merge(snap(b), snap(h2), snap(e2));
        expect(again.hubPatch).toEqual({});
        expect(again.externalPatch).toEqual({});
        expect(again.conflicts).toEqual(r.conflicts);
        expect(merge(snap(b), snap(h), snap(e))).toEqual(r);
      }),
      runs,
    );
  });

  it('no loss: every non-conflicting entry is preserved and both sides converge', () => {
    fc.assert(
      fc.property(fieldSet, fieldSet, fieldSet, (b, h, e) => {
        const r = merge(snap(b), snap(h), snap(e));
        const h2 = apply(h, r.hubPatch.fields);
        const e2 = apply(e, r.externalPatch.fields);
        const conflicted = new Set(
          r.conflicts.map(
            (c) => `${(c as { kind: string }).kind}|${(c as { normalized: string }).normalized}`,
          ),
        );
        const live = (fs: SnapshotField[]): string[] =>
          norm(fs.filter((x) => !conflicted.has(`${x.kind}|${x.normalized}`)));
        expect(live(h2)).toEqual(live(e2));
        // An entry present in base and untouched on both sides survives; one added anywhere survives.
        const bKeys = new Set(b.map((x) => `${x.kind}|${x.normalized}`));
        for (const x of [...h, ...e]) {
          const key = `${x.kind}|${x.normalized}`;
          if (!bKeys.has(key) && !conflicted.has(key)) {
            expect(h2.some((y) => `${y.kind}|${y.normalized}` === key)).toBe(true);
            expect(e2.some((y) => `${y.kind}|${y.normalized}` === key)).toBe(true);
          }
        }
      }),
      runs,
    );
  });

  it('one side wins: a one-sided change never conflicts and fully propagates', () => {
    fc.assert(
      fc.property(fieldSet, fieldSet, (b, changed) => {
        const fromExternal = merge(snap(b), snap(b), snap(changed));
        expect(fromExternal.conflicts).toEqual([]);
        expect(fromExternal.externalPatch).toEqual({});
        expect(norm(apply(b, fromExternal.hubPatch.fields))).toEqual(norm(changed));
        const fromHub = merge(snap(b), snap(changed), snap(b));
        expect(fromHub.conflicts).toEqual([]);
        expect(fromHub.hubPatch).toEqual({});
        expect(norm(apply(b, fromHub.externalPatch.fields))).toEqual(norm(changed));
      }),
      runs,
    );
  });

  it('symmetry: swapping hub and external swaps patches and conflict sides', () => {
    fc.assert(
      fc.property(fieldSet, fieldSet, fieldSet, (b, h, e) => {
        const r = merge(snap(b), snap(h), snap(e));
        const s = merge(snap(b), snap(e), snap(h));
        expect(s.hubPatch).toEqual(r.externalPatch);
        expect(s.externalPatch).toEqual(r.hubPatch);
        expect(s.conflicts).toEqual(
          r.conflicts.map((c) => ({ ...c, hub: c.external, external: c.hub })),
        );
      }),
      runs,
    );
  });
});
