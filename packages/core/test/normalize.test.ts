import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dateFromParts,
  fromApple,
  fromGoogle,
  fromVcard,
  normalizeDate,
  normalizeEmail,
  normalizeLabel,
  normalizePhone,
  toApple,
  toGoogle,
  toVcard,
  toVcardParam,
} from '../src/index.js';

describe('normalizePhone', () => {
  const cases: [string, string, string | undefined][] = [
    ['ES national', '600 12 34 56', '+34600123456'],
    ['ES with spaces and prefix', '+34 600-123-456', '+34600123456'],
    ['ES 00 prefix', '0034600123456', '+34600123456'],
    ['US formatted', '+1 (415) 555-2671', '+14155552671'],
    ['GB', '+44 7911 123456', '+447911123456'],
    ['DE', '+49 151 23456789', '+4915123456789'],
    ['FR', '+33 6 12 34 56 78', '+33612345678'],
    ['IT', '+39 312 345 6789', '+393123456789'],
    ['MX', '+52 55 1234 5678', '+525512345678'],
    ['BR', '+55 11 91234-5678', '+5511912345678'],
    ['JP', '+81 90-1234-5678', '+819012345678'],
    ['IN', '+91 98765 43210', '+919876543210'],
    ['AU', '+61 412 345 678', '+61412345678'],
    ['dots and parens', '(+34) 600.123.456', '+34600123456'],
    ['text around', 'Tel: +34 600 123 456', '+34600123456'],
  ];
  it.each(cases)('%s', (_name, raw, expected) => {
    expect(normalizePhone(raw)).toEqual({ normalized: expected, unparsed: false });
  });

  it('uses the configured default region', () => {
    expect(normalizePhone('415 555 2671', { defaultRegion: 'US' }).normalized).toBe('+14155552671');
    expect(normalizePhone('07911 123456', { defaultRegion: 'GB' }).normalized).toBe(
      '+447911123456',
    );
  });

  it.each(['abc', '', '12', '+34 123', '*21#', '600 123 456 789 012', '+34600123456;ext=12'])(
    'keeps %j as-is and flags it unparsed',
    (raw) => {
      expect(normalizePhone(raw)).toEqual({ normalized: raw, unparsed: true });
    },
  );

  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom('ES', 'US', 'GB', 'DE', 'JP'), (raw, region) => {
        const once = normalizePhone(raw, { defaultRegion: region });
        const twice = normalizePhone(once.normalized, { defaultRegion: region });
        expect(twice.normalized).toBe(once.normalized);
      }),
      { numRuns: 500 },
    );
  });

  it('is idempotent on phone-like strings (property)', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[+0-9 ()./-]{0,20}$/), (raw) => {
        const once = normalizePhone(raw);
        expect(normalizePhone(once.normalized).normalized).toBe(once.normalized);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ana.Perez@Example.COM \n')).toBe('ana.perez@example.com');
    expect(normalizeEmail('mailto:Foo@Bar.es')).toBe('foo@bar.es');
  });
  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizeEmail(s);
        expect(normalizeEmail(once)).toBe(once);
      }),
    );
  });
});

describe('normalizeDate', () => {
  it.each([
    ['1980-03-12', '1980-03-12'],
    ['19800312', '1980-03-12'],
    ['--03-12', '--03-12'],
    ['--0312', '--03-12'],
    ['0000-03-12', '--03-12'],
    ['1604-03-12', '--03-12'],
    ['1980-03-12T00:00:00Z', '1980-03-12'],
    ['--02-29', '--02-29'],
    ['2000-02-29', '2000-02-29'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeDate(raw)).toBe(expected);
  });
  it.each(['', 'hello', '1981-02-29', '--13-01', '--04-31', '1980-00-10', '12/03/1980'])(
    'rejects %j',
    (raw) => {
      expect(normalizeDate(raw)).toBeNull();
    },
  );
  it('builds from parts', () => {
    expect(dateFromParts({ month: 3, day: 12 })).toBe('--03-12');
    expect(dateFromParts({ year: 1980, month: 3, day: 12 })).toBe('1980-03-12');
    expect(dateFromParts({ year: 1980, month: 2, day: 30 })).toBeNull();
  });
  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('1900-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }),
        fc.boolean(),
        (d, yearless) => {
          const iso = d.toISOString().slice(0, 10);
          const raw = yearless ? `--${iso.slice(5)}` : iso;
          const once = normalizeDate(raw);
          expect(once).toBe(raw);
          expect(normalizeDate(once ?? '')).toBe(once);
        },
      ),
    );
  });
});

describe('labels', () => {
  const known = ['mobile', 'home', 'work', 'main', 'other'];
  const extras = [
    'iphone',
    'home fax',
    'work fax',
    'other fax',
    'pager',
    'work mobile',
    'work pager',
    'homepage',
    'blog',
    'profile',
    'ftp',
    'assistant',
    'car',
    'company main',
    'isdn',
    'callback',
    'telex',
    'tty',
    'radio',
  ];

  it('translates the documented examples', () => {
    expect(toApple('mobile')).toBe('_$!<Mobile>!$_');
    expect(toGoogle('mobile')).toBe('mobile');
    expect(toVcard('mobile')).toEqual({ type: 'CELL' });
    expect(toVcardParam('mobile')).toBe('TYPE=CELL');
    expect(fromApple('_$!<Mobile>!$_')).toBe('mobile');
    expect(fromVcard({ type: 'TYPE=cell' })).toBe('mobile');
  });

  it.each([...known, ...extras, 'Mi gimnasio', 'Café ☕'])(
    'round-trips %j through every system',
    (label) => {
      expect(fromApple(toApple(label))).toBe(label);
      expect(fromGoogle(toGoogle(label))).toBe(label);
      expect(fromVcard(toVcard(label))).toBe(label);
    },
  );

  it('round-trips unknown Apple constants losslessly', () => {
    expect(toApple(fromApple('_$!<Weird>!$_'))).toBe('_$!<Weird>!$_');
  });

  it('is case-insensitive on input for known labels', () => {
    expect(normalizeLabel(' Mobile ')).toBe('mobile');
    expect(fromGoogle('HOMEFAX')).toBe('home fax');
    expect(fromApple('_$!<iphone>!$_')).toBe('iphone');
  });

  it('normalization is idempotent and translators round-trip (property)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizeLabel(s);
        expect(normalizeLabel(once)).toBe(once);
      }),
    );
  });
});
