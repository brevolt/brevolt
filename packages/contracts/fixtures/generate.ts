import { contactFieldSchema, contactSchema } from '../src/contact.js';
import type { Contact, ContactField, ContactSnapshot } from '../src/contact.js';
import { createRng } from './rng.js';
import type { Rng } from './rng.js';

/** Synthetic data only (R-SEC-6): every value below is invented. */
const GIVEN_NAMES = [
  'José',
  'Zoë',
  'Åsa',
  'Émilie',
  'Łukasz',
  'Søren',
  'María',
  'Renée',
  '李雷',
  'Йохан',
  'Ada',
  'Alan',
];
const FAMILY_NAMES = [
  'García Núñez',
  'Müller',
  'Dvořák',
  "O'Brien",
  'Ñandú',
  'Lovelace',
  'Çelik',
  'Kowalski',
  '王',
  'Иванов',
];
const COMPANIES = [
  'Acme Ibérica S.L.',
  'Café Müller & Söhne',
  'Northwind',
  '株式会社テスト',
  'Initech',
];
const JOB_TITLES = ['Ingeniera', 'CTO', 'Médico', 'Designer', null] as const;
const EMOJIS = ['🎉', '🚀', '👨‍👩‍👧', '🇪🇸', '☕'];
const LABELS = ['mobile', 'home', 'work', 'main', 'other'] as const;

/** Valid, region-typical and deliberately malformed phone numbers. */
const PHONES = [
  '+34 612 34 56 78',
  '612345678',
  '+1 (415) 555-0132',
  '+44 20 7946 0958',
  '+49 30 901820',
  '+33 1 23 45 67 89',
  '+81 3-1234-5678',
  '+55 11 91234-5678',
  '+52 55 1234 5678',
  '+91 98765 43210',
  '+61 2 9876 5432',
  '0034 912 345 678',
  '+34-612.345.678',
] as const;
const MALFORMED_PHONES = [
  '12-34',
  'ext. 99',
  '+999 000',
  'llamar mañana',
  '+34 6',
  '()--',
] as const;
const EMAIL_DOMAINS = ['example.com', 'example.org', 'correo.example.es'] as const;

export interface GeneratedContact {
  contact: Contact;
  fields: ContactField[];
}

const TIMESTAMP = '2026-01-01T00:00:00Z';

/** Deterministic UUID v7-shaped id (version nibble 7, variant 8-b). */
function uuidV7(rng: Rng): string {
  return `${rng.hex(8)}-${rng.hex(4)}-7${rng.hex(3)}-${rng.pick(['8', '9', 'a', 'b'])}${rng.hex(3)}-${rng.hex(12)}`;
}

function accentFree(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase() || 'x'
  );
}

function generateOne(rng: Rng, index: number): GeneratedContact {
  const id = uuidV7(rng);
  const nameless = rng.chance(0.12);
  const given = nameless
    ? null
    : rng.pick(GIVEN_NAMES) + (rng.chance(0.15) ? ` ${rng.pick(EMOJIS)}` : '');
  const family = nameless || rng.chance(0.15) ? null : rng.pick(FAMILY_NAMES);
  const birthday = rng.chance(0.3)
    ? null
    : rng.chance(0.5)
      ? `--${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`
      : `${String(rng.int(1950, 2005))}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;

  const contact = contactSchema.parse({
    id,
    prefix: null,
    givenName: given,
    middleName: null,
    familyNames: family,
    suffix: null,
    nickname: null,
    company: nameless && rng.chance(0.5) ? null : rng.pick(COMPANIES),
    jobTitle: rng.pick(JOB_TITLES),
    birthday,
    noteMd: '',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    deletedAt: null,
  } satisfies Contact);

  const fields: ContactField[] = [];
  const add = (kind: ContactField['kind'], value: string, normalized: string): void => {
    fields.push(
      contactFieldSchema.parse({
        id: uuidV7(rng),
        contactId: id,
        kind,
        label: rng.pick(LABELS),
        value,
        normalized,
        position: fields.length,
      }),
    );
  };
  for (let i = rng.int(0, 3); i > 0; i--) {
    const phone = rng.chance(0.25) ? rng.pick(MALFORMED_PHONES) : rng.pick(PHONES);
    add('phone', phone, phone.replace(/[^\d+]/g, '') || phone);
  }
  for (let i = rng.int(0, 2); i > 0; i--) {
    const local = `${accentFree(given ?? 'anon')}.${accentFree(family ?? String(index))}`;
    const email = `${local}@${rng.pick(EMAIL_DOMAINS)}`;
    add('email', email, email.toLowerCase());
  }
  if (rng.chance(0.3)) {
    const address = `Calle Ficticia ${String(rng.int(1, 200))}, ${String(rng.int(10000, 52999))} Madrid`;
    add('address', address, address.toLowerCase());
  }
  if (rng.chance(0.2)) {
    const url = `https://example.com/${accentFree(given ?? 'p')}${String(index)}`;
    add('url', url, url);
  }
  return { contact, fields };
}

/** Same seed and count ⇒ exactly the same output. */
export function generateContacts(seed: number, count: number): GeneratedContact[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, (_, i) => generateOne(rng, i));
}

export function toSnapshot({ contact, fields }: GeneratedContact): ContactSnapshot {
  return {
    prefix: contact.prefix,
    givenName: contact.givenName,
    middleName: contact.middleName,
    familyNames: contact.familyNames,
    suffix: contact.suffix,
    nickname: contact.nickname,
    company: contact.company,
    jobTitle: contact.jobTitle,
    birthday: contact.birthday,
    fields: fields.map(({ kind, label, value, normalized }) => ({
      kind,
      label,
      value,
      normalized,
    })),
  };
}
