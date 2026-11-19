import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, displayName, pagesFor } from '../src/lib/window.js';

describe('windowing', () => {
  it('asks only for the pages that cover the range', () => {
    expect(pagesFor(0, 30)).toEqual([0]);
    expect(pagesFor(PAGE_SIZE - 2, PAGE_SIZE + 2)).toEqual([0, 1]);
    expect(pagesFor(10, 10)).toEqual([]);
  });

  it('names contacts from the best available field', () => {
    const base = { givenName: null, familyNames: null, company: null, nickname: null };
    expect(displayName({ ...base, givenName: 'Ada', familyNames: 'Lovelace' })).toBe(
      'Ada Lovelace',
    );
    expect(displayName({ ...base, company: 'Acme' })).toBe('Acme');
    expect(displayName(base)).toBe('(no name)');
  });
});
