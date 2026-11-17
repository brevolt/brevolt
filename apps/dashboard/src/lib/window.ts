export const ROW_HEIGHT = 52;
export const PAGE_SIZE = 200;

/** Rows to render for a scroll position, with `overscan` extra rows on each side. */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  total: number,
  overscan = 6,
): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + overscan);
  return { start, end: Math.max(start, end) };
}

/** Page numbers needed to cover rows `start`..`end` (exclusive). */
export function pagesFor(start: number, end: number): number[] {
  if (end <= start) return [];
  const pages: number[] = [];
  for (let p = Math.floor(start / PAGE_SIZE); p <= Math.floor((end - 1) / PAGE_SIZE); p++) {
    pages.push(p);
  }
  return pages;
}

export function displayName(c: {
  givenName: string | null;
  familyNames: string | null;
  company: string | null;
  nickname: string | null;
}): string {
  const full = [c.givenName, c.familyNames].filter(Boolean).join(' ');
  return full || c.nickname || c.company || '(no name)';
}
