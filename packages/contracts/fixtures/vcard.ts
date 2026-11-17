import type { GeneratedContact } from './generate.js';

const escapeText = (v: string): string =>
  v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');

/** UTF-8 byte length of a single code point (avoids depending on Node typings). */
export function utf8Length(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** Fold lines longer than 75 octets (RFC 6350 §3.2), never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = utf8Length(ch);
    if (bytes + size > limit) {
      out.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n');
}

const TYPE_BY_LABEL: Record<string, string> = {
  mobile: 'CELL',
  home: 'HOME',
  work: 'WORK',
  main: 'PREF',
};

/** vCard 3.0 export, importable in Contacts/Google test accounts. Contacts without a name get FN from company or a placeholder. */
export function toVCard({ contact, fields }: GeneratedContact): string {
  const nameParts = [contact.givenName, contact.familyNames].filter((p): p is string => !!p);
  const fn = nameParts.join(' ') || contact.company || 'Sin nombre';
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${contact.id}`,
    `N:${[
      contact.familyNames,
      contact.givenName,
      contact.middleName,
      contact.prefix,
      contact.suffix,
    ]
      .map((p) => escapeText(p ?? ''))
      .join(';')}`,
    `FN:${escapeText(fn)}`,
  ];
  if (contact.company) lines.push(`ORG:${escapeText(contact.company)}`);
  if (contact.jobTitle) lines.push(`TITLE:${escapeText(contact.jobTitle)}`);
  // vCard 3.0 has no year-less date syntax; the `--MMDD` form is the widely accepted one.
  if (contact.birthday)
    lines.push(
      `BDAY:${contact.birthday.startsWith('--') ? contact.birthday.replace(/-/g, '').replace(/^/, '--') : contact.birthday}`,
    );
  for (const f of fields) {
    const type = TYPE_BY_LABEL[f.label];
    const params = type ? `;TYPE=${type}` : '';
    switch (f.kind) {
      case 'phone':
        lines.push(`TEL${params}:${escapeText(f.value)}`);
        break;
      case 'email':
        lines.push(`EMAIL${params}:${escapeText(f.value)}`);
        break;
      case 'url':
        lines.push(`URL${params}:${f.value}`);
        break;
      case 'address':
        lines.push(`ADR${params}:;;${escapeText(f.value)};;;;`);
        break;
    }
  }
  lines.push('END:VCARD');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function toVCardFile(contacts: readonly GeneratedContact[]): string {
  return contacts.map(toVCard).join('');
}

/** UTF-8 byte length of a string. */
export function byteLength(text: string): number {
  let total = 0;
  for (const ch of text) total += utf8Length(ch);
  return total;
}
