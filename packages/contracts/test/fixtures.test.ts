import { describe, expect, it } from 'vitest';
import { contactSnapshotSchema } from '../src/index.js';
import { MERGE_CORPUS } from '../fixtures/corpus.js';
import { generateContacts, toSnapshot } from '../fixtures/generate.js';
import { byteLength, foldLine, toVCardFile } from '../fixtures/vcard.js';

describe('synthetic generator', () => {
  it('same seed produces exactly the same output', () => {
    expect(generateContacts(42, 200)).toEqual(generateContacts(42, 200));
    expect(toVCardFile(generateContacts(42, 200))).toBe(toVCardFile(generateContacts(42, 200)));
  });

  it('different seeds produce different output', () => {
    expect(generateContacts(1, 50)).not.toEqual(generateContacts(2, 50));
  });

  it('covers the required edge cases', () => {
    const all = generateContacts(7, 500);
    const fields = all.flatMap((c) => c.fields);
    expect(all.some((c) => c.contact.givenName === null && c.contact.familyNames === null)).toBe(
      true,
    );
    expect(all.some((c) => c.contact.birthday?.startsWith('--'))).toBe(true);
    expect(all.some((c) => /[À-ÿ]/.test(c.contact.givenName ?? ''))).toBe(true);
    expect(all.some((c) => /\p{Extended_Pictographic}/u.test(c.contact.givenName ?? ''))).toBe(
      true,
    );
    const phones = fields.filter((f) => f.kind === 'phone').map((f) => f.value);
    expect(new Set(phones.filter((p) => p.startsWith('+'))).size).toBeGreaterThan(8);
    expect(phones.some((p) => !/\d{6,}/.test(p.replace(/\D/g, '')))).toBe(true);
  });

  it('produces schema-valid snapshots and unique ids', () => {
    const all = generateContacts(3, 300);
    for (const c of all) contactSnapshotSchema.parse(toSnapshot(c));
    expect(new Set(all.map((c) => c.contact.id)).size).toBe(all.length);
  });
});

describe('vCard export', () => {
  const vcf = toVCardFile(generateContacts(5, 100));

  it('emits one well-formed card per contact with CRLF and folded lines', () => {
    expect(vcf.match(/^BEGIN:VCARD\r$/gm)).toHaveLength(100);
    expect(vcf.match(/^END:VCARD\r$/gm)).toHaveLength(100);
    for (const line of vcf.split('\r\n')) expect(byteLength(line)).toBeLessThanOrEqual(75);
  });

  it('gives every card an FN, even without a name', () => {
    const cards = vcf.split('END:VCARD\r\n').filter(Boolean);
    expect(cards.every((c) => /\r\nFN:.+/.test(c))).toBe(true);
  });

  it('folds without splitting multi-byte characters', () => {
    const folded = foldLine(`NOTE:${'🎉'.repeat(40)}`);
    expect(folded.replace(/\r\n /g, '')).toBe(`NOTE:${'🎉'.repeat(40)}`);
  });

  it('encodes year-less birthdays as --MMDD', () => {
    expect(vcf).toMatch(/^BDAY:--\d{4}\r$/m);
  });
});

describe('merge corpus', () => {
  it('covers the four rows of the merge table', () => {
    const rows = new Set(MERGE_CORPUS.map((c) => c.row));
    for (const row of ['external-wins', 'hub-wins', 'same-change', 'conflict'] as const)
      expect(rows.has(row)).toBe(true);
  });

  it('has schema-valid snapshots whose shape matches the declared row', () => {
    for (const c of MERGE_CORPUS) {
      for (const s of [c.base, c.hub, c.external]) contactSnapshotSchema.parse(s);
      const hubChanged = c.hub[c.field] !== c.base[c.field];
      const extChanged = c.external[c.field] !== c.base[c.field];
      const same = c.hub[c.field] === c.external[c.field];
      const row =
        !hubChanged && !extChanged
          ? 'no-change'
          : !hubChanged
            ? 'external-wins'
            : !extChanged
              ? 'hub-wins'
              : same
                ? 'same-change'
                : 'conflict';
      expect(row, c.name).toBe(c.row);
      expect(c.expected, c.name).toBe(
        c.row === 'conflict'
          ? null
          : c.row === 'external-wins'
            ? c.external[c.field]
            : c.hub[c.field],
      );
    }
  });
});
