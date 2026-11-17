import { z } from 'zod';

/** UUID v7, the only id format used for hub entities. */
export const uuidV7 = z.uuid({ version: 'v7' });
export type UuidV7 = z.infer<typeof uuidV7>;

const isoTimestamp = z.iso.datetime({ offset: true });
/** ISO 8601 date, or a year-less birthday such as `--03-12`. */
export const birthdaySchema = z.union([
  z.iso.date(),
  z.string().regex(/^--(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Invalid year-less birthday'),
]);

export const contactFieldKindSchema = z.enum(['phone', 'email', 'address', 'url']);
export type ContactFieldKind = z.infer<typeof contactFieldKindSchema>;

/** Own label vocabulary: the known labels or free text. */
export const KNOWN_LABELS = ['mobile', 'home', 'work', 'main', 'other'] as const;
export const labelSchema = z.string().trim().min(1);

export const contactFieldSchema = z.strictObject({
  id: uuidV7,
  contactId: uuidV7,
  kind: contactFieldKindSchema,
  label: labelSchema,
  value: z.string().min(1),
  normalized: z.string().min(1),
  position: z.number().int().nonnegative(),
});
export type ContactField = z.infer<typeof contactFieldSchema>;

export const tagSchema = z.strictObject({
  id: uuidV7,
  name: z.string().trim().min(1),
});
export type Tag = z.infer<typeof tagSchema>;

export const contactTagSchema = z.strictObject({ contactId: uuidV7, tagId: uuidV7 });
export type ContactTag = z.infer<typeof contactTagSchema>;

export const customFieldSchema = z.strictObject({
  contactId: uuidV7,
  key: z.string().min(1),
  value: z.string(),
});
export type CustomField = z.infer<typeof customFieldSchema>;

export const externalSystemSchema = z.enum(['icloud', 'google', 'obsidian']);
export type ExternalSystem = z.infer<typeof externalSystemSchema>;

export const externalLinkSchema = z.strictObject({
  contactId: uuidV7,
  system: externalSystemSchema,
  externalId: z.string().min(1),
  etag: z.string().nullable(),
});
export type ExternalLink = z.infer<typeof externalLinkSchema>;

export const contactSchema = z.strictObject({
  id: uuidV7,
  prefix: z.string().nullable(),
  givenName: z.string().nullable(),
  middleName: z.string().nullable(),
  familyNames: z.string().nullable(),
  suffix: z.string().nullable(),
  nickname: z.string().nullable(),
  company: z.string().nullable(),
  jobTitle: z.string().nullable(),
  birthday: birthdaySchema.nullable(),
  noteMd: z.string(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  deletedAt: isoTimestamp.nullable(),
});
export type Contact = z.infer<typeof contactSchema>;

/** Normalized, system-independent view of a contact: the unit of the three-way merge. */
export const snapshotFieldSchema = contactFieldSchema.pick({
  kind: true,
  label: true,
  value: true,
  normalized: true,
});
export const contactSnapshotSchema = z.strictObject({
  prefix: contactSchema.shape.prefix,
  givenName: contactSchema.shape.givenName,
  middleName: contactSchema.shape.middleName,
  familyNames: contactSchema.shape.familyNames,
  suffix: contactSchema.shape.suffix,
  nickname: contactSchema.shape.nickname,
  company: contactSchema.shape.company,
  jobTitle: contactSchema.shape.jobTitle,
  birthday: contactSchema.shape.birthday,
  fields: z.array(snapshotFieldSchema),
});
export type ContactSnapshot = z.infer<typeof contactSnapshotSchema>;

export const syncBaseSchema = z.strictObject({
  contactId: uuidV7,
  system: externalSystemSchema,
  snapshot: contactSnapshotSchema,
  hash: z.string().min(1),
  syncedAt: isoTimestamp,
});
export type SyncBase = z.infer<typeof syncBaseSchema>;
