/**
 * Own label vocabulary and per-system translators.
 * Known labels: mobile, home, work, main, other. Anything else is free text.
 * Extra system-defined labels (fax, pager, ...) are represented as lowercase
 * free-text names so they survive a round trip through every system.
 */
export const KNOWN_LABELS = ['mobile', 'home', 'work', 'main', 'other'] as const;
export type KnownLabel = (typeof KNOWN_LABELS)[number];

interface LabelDef {
  /** Own name. */
  label: string;
  /** Apple constant name, as in `_$!<Name>!$_`. */
  apple: string;
  /** Google People API `type` value. */
  google: string;
  /** vCard `TYPE=` token (uppercase). */
  vcard: string;
}

const DEFS: readonly LabelDef[] = [
  { label: 'mobile', apple: 'Mobile', google: 'mobile', vcard: 'CELL' },
  { label: 'home', apple: 'Home', google: 'home', vcard: 'HOME' },
  { label: 'work', apple: 'Work', google: 'work', vcard: 'WORK' },
  { label: 'main', apple: 'Main', google: 'main', vcard: 'X-MAIN' },
  { label: 'other', apple: 'Other', google: 'other', vcard: 'X-OTHER' },
  // Extra system-defined labels, kept as free text in the own vocabulary.
  { label: 'iphone', apple: 'iPhone', google: 'iphone', vcard: 'X-IPHONE' },
  { label: 'home fax', apple: 'HomeFAX', google: 'homeFax', vcard: 'FAX' },
  { label: 'work fax', apple: 'WorkFAX', google: 'workFax', vcard: 'X-WORK-FAX' },
  { label: 'other fax', apple: 'OtherFAX', google: 'otherFax', vcard: 'X-OTHER-FAX' },
  { label: 'pager', apple: 'Pager', google: 'pager', vcard: 'PAGER' },
  { label: 'work mobile', apple: 'WorkMobile', google: 'workMobile', vcard: 'X-WORK-MOBILE' },
  { label: 'work pager', apple: 'WorkPager', google: 'workPager', vcard: 'X-WORK-PAGER' },
  { label: 'homepage', apple: 'HomePage', google: 'homepage', vcard: 'X-HOMEPAGE' },
  { label: 'blog', apple: 'Blog', google: 'blog', vcard: 'X-BLOG' },
  { label: 'profile', apple: 'Profile', google: 'profile', vcard: 'X-PROFILE' },
  { label: 'ftp', apple: 'FTP', google: 'ftp', vcard: 'X-FTP' },
  { label: 'assistant', apple: 'Assistant', google: 'assistant', vcard: 'X-ASSISTANT' },
  { label: 'car', apple: 'Car', google: 'car', vcard: 'X-CAR' },
  { label: 'company main', apple: 'CompanyMain', google: 'companyMain', vcard: 'X-COMPANY-MAIN' },
  { label: 'isdn', apple: 'ISDN', google: 'isdn', vcard: 'X-ISDN' },
  { label: 'callback', apple: 'Callback', google: 'callback', vcard: 'X-CALLBACK' },
  { label: 'telex', apple: 'Telex', google: 'telex', vcard: 'X-TELEX' },
  { label: 'tty', apple: 'TTY', google: 'tty', vcard: 'X-TTY' },
  { label: 'radio', apple: 'Radio', google: 'radio', vcard: 'X-RADIO' },
];

const byLabel = new Map(DEFS.map((d) => [d.label, d]));
const byApple = new Map(DEFS.map((d) => [d.apple.toLowerCase(), d]));
const byGoogle = new Map(DEFS.map((d) => [d.google.toLowerCase(), d]));
const byVcard = new Map(DEFS.map((d) => [d.vcard, d]));

const APPLE_WRAPPED = /^_\$!<(.+)>!\$_$/;

/** Trims; known labels (any case) become their lowercase name, free text is kept. Idempotent. */
export function normalizeLabel(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  return byLabel.has(lower) ? lower : trimmed;
}

export function isKnownLabel(label: string): label is KnownLabel {
  return (KNOWN_LABELS as readonly string[]).includes(label);
}

// --- Apple -----------------------------------------------------------------

export function toApple(label: string): string {
  const own = normalizeLabel(label);
  const def = byLabel.get(own);
  return def ? `_$!<${def.apple}>!$_` : own;
}

export function fromApple(raw: string): string {
  const trimmed = raw.trim();
  const m = APPLE_WRAPPED.exec(trimmed);
  if (!m) return normalizeLabel(trimmed);
  // Unknown wrapped constants are kept verbatim so they round-trip losslessly.
  return byApple.get((m[1] ?? '').toLowerCase())?.label ?? trimmed;
}

// --- Google ----------------------------------------------------------------

/** Google `type`: a predefined type, or any custom string. */
export function toGoogle(label: string): string {
  const own = normalizeLabel(label);
  return byLabel.get(own)?.google ?? own;
}

export function fromGoogle(raw: string): string {
  const trimmed = raw.trim();
  return byGoogle.get(trimmed.toLowerCase())?.label ?? normalizeLabel(trimmed);
}

// --- vCard -----------------------------------------------------------------

export interface VcardLabel {
  /** Value for `TYPE=` (known labels). */
  type?: string;
  /** Value for an `X-ABLabel` line (free text). */
  xAbLabel?: string;
}

export function toVcard(label: string): VcardLabel {
  const own = normalizeLabel(label);
  const def = byLabel.get(own);
  return def ? { type: def.vcard } : { xAbLabel: own };
}

export function fromVcard(input: VcardLabel): string {
  if (input.xAbLabel !== undefined) {
    const fromApplePrefixed = APPLE_WRAPPED.test(input.xAbLabel.trim());
    return fromApplePrefixed ? fromApple(input.xAbLabel) : normalizeLabel(input.xAbLabel);
  }
  const token = (input.type ?? '')
    .trim()
    .replace(/^TYPE=/i, '')
    .toUpperCase();
  return byVcard.get(token)?.label ?? 'other';
}

/** Formats the vCard parameter, e.g. `TYPE=CELL`; null for free text. */
export function toVcardParam(label: string): string | null {
  const { type } = toVcard(label);
  return type ? `TYPE=${type}` : null;
}
