import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { merge, SCALAR_FIELDS, type ScalarSnapshot } from '../src/index.js';

const empty: ScalarSnapshot = {
  prefix: null,
  givenName: null,
  middleName: null,
  familyNames: null,
  suffix: null,
  nickname: null,
  company: null,
  jobTitle: null,
  birthday: null,
};
const base: ScalarSnapshot = { ...empty, givenName: 'Ana', company: 'Acme', birthday: '--03-12' };

describe('merge scalar fields: table rows', () => {
  it('row 1: only external changed → external wins, applied to hub', () => {
    const r = merge(base, base, { ...base, company: 'Globex' });
    expect(r).toEqual({ hubPatch: { company: 'Globex' }, externalPatch: {}, conflicts: [] });
  });

  it('row 2: only hub changed → hub wins, sent to external', () => {
    const r = merge(base, { ...base, jobTitle: 'CTO' }, base);
    expect(r).toEqual({ hubPatch: {}, externalPatch: { jobTitle: 'CTO' }, conflicts: [] });
  });

  it('row 3: both changed to the same value → nothing to do', () => {
    const changed = { ...base, givenName: 'Anna' };
    expect(merge(base, changed, changed)).toEqual({
      hubPatch: {},
      externalPatch: {},
      conflicts: [],
    });
  });

  it('row 4: both changed differently → conflict, nothing written', () => {
    const r = merge(base, { ...base, givenName: 'Anna' }, { ...base, givenName: 'Ann' });
    expect(r.hubPatch).toEqual({});
    expect(r.externalPatch).toEqual({});
    expect(r.conflicts).toEqual([
      { field: 'givenName', base: 'Ana', hub: 'Anna', external: 'Ann' },
    ]);
  });

  it('handles clearing a value (null) and birthday changes', () => {
    const r = merge(base, base, { ...base, company: null, birthday: '1990-03-12' });
    expect(r.hubPatch).toEqual({ company: null, birthday: '1990-03-12' });
  });

  it('merges independent fields independently', () => {
    const r = merge(
      base,
      { ...base, company: 'Hub Co', givenName: 'H' },
      { ...base, jobTitle: 'Dev', givenName: 'E' },
    );
    expect(r.hubPatch).toEqual({ jobTitle: 'Dev' });
    expect(r.externalPatch).toEqual({ company: 'Hub Co' });
    expect(r.conflicts).toHaveLength(1);
  });

  it('does not mutate its inputs', () => {
    const h = Object.freeze({ ...base, company: 'X' });
    const e = Object.freeze({ ...base, jobTitle: 'Y' });
    expect(() => merge(Object.freeze(base), h, e)).not.toThrow();
  });
});

const val = fc.option(fc.constantFrom('a', 'b', 'c', 'd'), { nil: null });
const snapshot = fc.record(
  Object.fromEntries(SCALAR_FIELDS.map((f) => [f, val])) as Record<
    (typeof SCALAR_FIELDS)[number],
    typeof val
  >,
) as fc.Arbitrary<ScalarSnapshot>;

const runs = { numRuns: 1000 };
const apply = (s: ScalarSnapshot, p: Partial<ScalarSnapshot>): ScalarSnapshot => ({ ...s, ...p });

describe('merge scalar fields: properties (1000 runs)', () => {
  it('idempotence: re-merging after applying the patches yields no changes', () => {
    fc.assert(
      fc.property(snapshot, snapshot, snapshot, (b, h, e) => {
        const r = merge(b, h, e);
        const h2 = apply(h, r.hubPatch);
        const e2 = apply(e, r.externalPatch);
        const again = merge(b, h2, e2);
        expect(again.hubPatch).toEqual({});
        expect(again.externalPatch).toEqual({});
        expect(again.conflicts).toEqual(r.conflicts);
        expect(merge(b, h, e)).toEqual(r);
      }),
      runs,
    );
  });

  it('one side wins: a one-sided change is never a conflict and always propagates', () => {
    fc.assert(
      fc.property(snapshot, snapshot, (b, changed) => {
        const fromExternal = merge(b, b, changed);
        expect(fromExternal.conflicts).toEqual([]);
        expect(fromExternal.externalPatch).toEqual({});
        expect(apply(b, fromExternal.hubPatch)).toEqual(changed);

        const fromHub = merge(b, changed, b);
        expect(fromHub.conflicts).toEqual([]);
        expect(fromHub.hubPatch).toEqual({});
        expect(apply(b, fromHub.externalPatch)).toEqual(changed);
      }),
      runs,
    );
  });

  it('conflict symmetry: swapping hub and external swaps patches and conflict sides', () => {
    fc.assert(
      fc.property(snapshot, snapshot, snapshot, (b, h, e) => {
        const r = merge(b, h, e);
        const s = merge(b, e, h);
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
