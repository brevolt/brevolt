/** Trims whitespace and lowercases. A `mailto:` prefix is dropped. Idempotent. */
export function normalizeEmail(raw: string): string {
  let value = raw.trim();
  if (/^mailto:/i.test(value)) value = value.slice('mailto:'.length).trim();
  return value.toLowerCase();
}
