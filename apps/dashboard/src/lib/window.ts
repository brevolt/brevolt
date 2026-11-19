export const ROW_HEIGHT = 64;
export const PAGE_SIZE = 200;

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
