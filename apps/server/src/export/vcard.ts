import type { ContactView } from '../contacts/service.js';

const TEL_TYPES: Record<string, string> = {
  mobile: 'CELL',
  home: 'HOME',
  work: 'WORK',
  main: 'PREF',
  other: 'VOICE',
};
const SIMPLE_TYPES: Record<string, string> = { home: 'HOME', work: 'WORK', main: 'PREF' };

/** RFC 2426 text escaping. */
const esc = (v: string): string =>
  v.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');

/** Folds a content line at 75 octets with CRLF + space continuation, never splitting a character. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > limit) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

function displayName(c: ContactView): string {
  const parts = [c.prefix, c.givenName, c.middleName, c.familyNames, c.suffix].filter(Boolean);
  return parts.join(' ') || c.nickname || c.company || 'Unnamed';
}

/** Serialises one contact as a vCard 3.0 card (the version macOS Contacts imports most reliably). */
export function contactToVCard(c: ContactView): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `UID:${c.id}`];
  lines.push(
    `N:${[c.familyNames, c.givenName, c.middleName, c.prefix, c.suffix].map((p) => esc(p ?? '')).join(';')}`,
  );
  lines.push(`FN:${esc(displayName(c))}`);
  if (c.nickname) lines.push(`NICKNAME:${esc(c.nickname)}`);
  if (c.company) lines.push(`ORG:${esc(c.company)}`);
  if (c.jobTitle) lines.push(`TITLE:${esc(c.jobTitle)}`);
  if (c.birthday) lines.push(`BDAY:${c.birthday}`);

  let group = 0;
  for (const f of c.fields) {
    const known = f.kind === 'phone' ? TEL_TYPES[f.label] : SIMPLE_TYPES[f.label];
    const prefix = known || f.label === '' ? '' : `item${String(++group)}.`;
    let name: string;
    let value = esc(f.value);
    if (f.kind === 'phone') name = 'TEL';
    else if (f.kind === 'email') name = 'EMAIL';
    else if (f.kind === 'url') name = 'URL';
    else {
      name = 'ADR';
      value = `;;${value};;;;`;
    }
    const params: string[] = [];
    if (f.kind === 'email') params.push('INTERNET');
    if (known) params.push(known);
    const typeParam = params.length ? `;TYPE=${params.join(',')}` : '';
    lines.push(`${prefix}${name}${typeParam}:${value}`);
    if (prefix) lines.push(`${prefix}X-ABLabel:${esc(f.label)}`);
  }
  if (c.tags.length) lines.push(`CATEGORIES:${c.tags.map(esc).join(',')}`);
  if (c.noteMd) lines.push(`NOTE:${esc(c.noteMd)}`);
  lines.push(`REV:${c.updatedAt}`, 'END:VCARD');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export const contactsToVCard = (contacts: ContactView[]): string =>
  contacts.map(contactToVCard).join('');
