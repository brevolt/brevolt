import { describe, expect, it } from 'vitest';
import {
  contactFieldSchema,
  contactSchema,
  contactTagSchema,
  customFieldSchema,
  externalLinkSchema,
  syncBaseSchema,
  tagSchema,
  uuidV7,
} from '../src/index.js';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const ID2 = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const V4 = '3b241101-e2bb-4255-8caf-4136c566a962';
const TS = '2026-11-16T12:00:00Z';

const contact = {
  id: ID,
  prefix: null,
  givenName: 'Ada',
  middleName: null,
  familyNames: 'Lovelace',
  suffix: null,
  nickname: null,
  company: null,
  jobTitle: null,
  birthday: '--03-12',
  noteMd: '',
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
};
const field = {
  id: ID,
  contactId: ID2,
  kind: 'phone',
  label: 'mobile',
  value: '600 000 000',
  normalized: '+34600000000',
  position: 0,
};
const snapshot = {
  prefix: null,
  givenName: 'Ada',
  middleName: null,
  familyNames: null,
  suffix: null,
  nickname: null,
  company: null,
  jobTitle: null,
  birthday: null,
  fields: [{ kind: 'email', label: 'work', value: 'A@x.io', normalized: 'a@x.io' }],
};

describe('uuidV7', () => {
  it('accepts v7 and rejects v4 and junk', () => {
    expect(uuidV7.safeParse(ID).success).toBe(true);
    expect(uuidV7.safeParse(V4).success).toBe(false);
    expect(uuidV7.safeParse('nope').success).toBe(false);
  });
});

describe('contactSchema', () => {
  it('accepts a valid contact, with and without birthday year', () => {
    expect(contactSchema.safeParse(contact).success).toBe(true);
    expect(contactSchema.safeParse({ ...contact, birthday: '1990-03-12' }).success).toBe(true);
    expect(contactSchema.safeParse({ ...contact, birthday: null }).success).toBe(true);
  });
  it.each([
    ['non-v7 id', { id: V4 }],
    ['bad birthday', { birthday: '--13-40' }],
    ['bad timestamp', { createdAt: 'yesterday' }],
    ['unknown key', { extra: 1 }],
    ['missing noteMd', { noteMd: undefined }],
  ])('rejects %s', (_n, patch) => {
    expect(contactSchema.safeParse({ ...contact, ...patch }).success).toBe(false);
  });
});

describe('contactFieldSchema', () => {
  it('accepts valid fields incl. free-text label', () => {
    expect(contactFieldSchema.safeParse(field).success).toBe(true);
    expect(contactFieldSchema.safeParse({ ...field, label: 'abuela' }).success).toBe(true);
  });
  it.each([
    ['bad kind', { kind: 'fax' }],
    ['empty value', { value: '' }],
    ['negative position', { position: -1 }],
    ['non-v7 contactId', { contactId: V4 }],
  ])('rejects %s', (_n, patch) => {
    expect(contactFieldSchema.safeParse({ ...field, ...patch }).success).toBe(false);
  });
});

describe('tags and custom fields', () => {
  it('validates tag, contact_tag and custom_field', () => {
    expect(tagSchema.safeParse({ id: ID, name: 'family' }).success).toBe(true);
    expect(tagSchema.safeParse({ id: ID, name: '  ' }).success).toBe(false);
    expect(contactTagSchema.safeParse({ contactId: ID, tagId: ID2 }).success).toBe(true);
    expect(contactTagSchema.safeParse({ contactId: ID, tagId: V4 }).success).toBe(false);
    expect(customFieldSchema.safeParse({ contactId: ID, key: 'k', value: '' }).success).toBe(true);
    expect(customFieldSchema.safeParse({ contactId: ID, key: '', value: 'v' }).success).toBe(false);
  });
});

describe('externalLinkSchema', () => {
  const link = { contactId: ID, system: 'google', externalId: 'people/c1', etag: null };
  it('accepts valid links', () => {
    expect(externalLinkSchema.safeParse(link).success).toBe(true);
    expect(externalLinkSchema.safeParse({ ...link, etag: '%EgM' }).success).toBe(true);
  });
  it('rejects unknown system and empty externalId', () => {
    expect(externalLinkSchema.safeParse({ ...link, system: 'outlook' }).success).toBe(false);
    expect(externalLinkSchema.safeParse({ ...link, externalId: '' }).success).toBe(false);
  });
});

describe('syncBaseSchema', () => {
  const base = { contactId: ID, system: 'icloud', snapshot, hash: 'abc', syncedAt: TS };
  it('accepts a valid base', () => {
    expect(syncBaseSchema.safeParse(base).success).toBe(true);
  });
  it.each([
    ['bad system', { system: 'x' }],
    ['empty hash', { hash: '' }],
    [
      'bad snapshot field kind',
      {
        snapshot: {
          ...snapshot,
          fields: [{ kind: 'fax', label: 'a', value: 'b', normalized: 'b' }],
        },
      },
    ],
    ['snapshot without fields', { snapshot: { ...snapshot, fields: undefined } }],
  ])('rejects %s', (_n, patch) => {
    expect(syncBaseSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});
