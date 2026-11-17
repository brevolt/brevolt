import type { ContactSnapshot } from '../src/contact.js';

/** Which row of the spec's three-way merge table a case exercises. */
export type MergeRow = 'external-wins' | 'hub-wins' | 'same-change' | 'conflict' | 'no-change';

export interface MergeCase {
  name: string;
  row: MergeRow;
  base: ContactSnapshot;
  hub: ContactSnapshot;
  external: ContactSnapshot;
  /** Scalar field the case changes. */
  field: 'givenName' | 'familyNames' | 'company' | 'jobTitle' | 'birthday';
  /** Expected final value, or null for conflicts (nothing is written anywhere). */
  expected: string | null;
}

const empty: ContactSnapshot = {
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

const base: ContactSnapshot = {
  ...empty,
  givenName: 'José',
  familyNames: 'García Núñez',
  company: 'Acme Ibérica S.L.',
  jobTitle: 'Ingeniero',
  birthday: '--03-12',
  fields: [
    { kind: 'phone', label: 'mobile', value: '+34 612 34 56 78', normalized: '+34612345678' },
  ],
};

function make(
  name: string,
  row: MergeRow,
  field: MergeCase['field'],
  hubValue: string | null,
  externalValue: string | null,
  expected: string | null,
  from: ContactSnapshot = base,
): MergeCase {
  return {
    name,
    row,
    field,
    base: from,
    hub: { ...from, [field]: hubValue },
    external: { ...from, [field]: externalValue },
    expected,
  };
}

export const MERGE_CORPUS: readonly MergeCase[] = [
  // Row 1: only the external side changed → external wins.
  make('external renames with accents', 'external-wins', 'givenName', 'José', 'Zoë', 'Zoë'),
  make('external adds an emoji', 'external-wins', 'givenName', 'José', 'José 🎉', 'José 🎉'),
  make(
    'external fills a birthday year',
    'external-wins',
    'birthday',
    '--03-12',
    '1985-03-12',
    '1985-03-12',
  ),
  // Row 2: only the hub changed → hub wins.
  make(
    'hub changes company',
    'hub-wins',
    'company',
    'Café Müller & Söhne',
    'Acme Ibérica S.L.',
    'Café Müller & Söhne',
  ),
  make('hub clears job title', 'hub-wins', 'jobTitle', null, 'Ingeniero', null),
  make(
    'hub drops the year of a birthday',
    'hub-wins',
    'birthday',
    '--03-12',
    '1985-03-12',
    '--03-12',
    {
      ...base,
      birthday: '1985-03-12',
    },
  ),
  // Row 3: both changed to the same value → nothing to do.
  make('both rename identically', 'same-change', 'familyNames', 'Müller', 'Müller', 'Müller'),
  make('both clear the company', 'same-change', 'company', null, null, null),
  // Row 4: both changed differently → conflict.
  make('divergent names', 'conflict', 'givenName', 'Åsa', 'Zoë', null),
  make(
    'divergent birthdays, one without year',
    'conflict',
    'birthday',
    '--04-01',
    '1985-04-01',
    null,
  ),
  make('one clears, other edits', 'conflict', 'jobTitle', null, 'CTO', null),
  // Baseline: nobody changed anything.
  make('no change', 'no-change', 'givenName', 'José', 'José', 'José'),
  // Nameless contact: company is the only identity.
  make(
    'nameless contact, company changes externally',
    'external-wins',
    'company',
    null,
    'Initech',
    'Initech',
    {
      ...empty,
      company: null,
      fields: [{ kind: 'phone', label: 'main', value: '12-34', normalized: '12-34' }],
    },
  ),
];
