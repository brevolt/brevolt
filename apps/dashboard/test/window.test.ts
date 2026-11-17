import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, ROW_HEIGHT, displayName, pagesFor, visibleRange } from '../src/lib/window.js';

describe('windowing', () => {
  it('renders only the rows in view plus overscan, even with 5,000 rows', () => {
    const { start, end } = visibleRange(0, 600, 5000);
    expect(start).toBe(0);
    expect(end).toBeLessThan(30);
  });

  it('follows the scroll position and clamps to the total', () => {
    const r = visibleRange(ROW_HEIGHT * 4990, 600, 5000);
    expect(r.end).toBe(5000);
    expect(r.start).toBeGreaterThan(4900);
  });

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
