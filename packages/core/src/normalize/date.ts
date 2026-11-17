export interface DateParts {
  /** Omitted/null for a birthday without a year. */
  year?: number | null;
  month: number;
  day: number;
}

/** Years Apple/Google use as placeholder for "no year". */
const PLACEHOLDER_YEARS = new Set([0, 1604]);

const pad = (n: number, len: number): string => String(n).padStart(len, '0');

function daysInMonth(year: number | null, month: number): number {
  if (month === 2) {
    if (year === null) return 29; // year-less birthdays may be Feb 29
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Builds `YYYY-MM-DD` or `--MM-DD`; returns null when the date does not exist. */
export function dateFromParts(parts: DateParts): string | null {
  const { month, day } = parts;
  const year = parts.year == null || PLACEHOLDER_YEARS.has(parts.year) ? null : parts.year;
  if (![month, day].every(Number.isInteger) || month < 1 || month > 12 || day < 1) return null;
  if (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999)) return null;
  if (day > daysInMonth(year, month)) return null;
  return year === null
    ? `--${pad(month, 2)}-${pad(day, 2)}`
    : `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Normalizes a date to ISO 8601 (`YYYY-MM-DD`) or a year-less `--MM-DD`.
 * Accepts `1980-03-12`, `19800312`, `--03-12`, `--0312`, and placeholder years
 * (`0000-03-12`, `1604-03-12`). Returns null if it is not a valid date. Idempotent.
 */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^--(\d{2})-?(\d{2})$/.exec(s);
  if (m) return dateFromParts({ month: Number(m[1]), day: Number(m[2]) });
  m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (m) return dateFromParts({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
  m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s); // full timestamp: keep the date part
  if (m) return dateFromParts({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
  return null;
}
