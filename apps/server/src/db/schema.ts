import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Hub tables from docs/spec.md. Ids are UUID v7 text; timestamps are ISO 8601 text. */

export const contact = sqliteTable(
  'contact',
  {
    id: text('id').primaryKey(),
    prefix: text('prefix'),
    givenName: text('given_name'),
    middleName: text('middle_name'),
    familyNames: text('family_names'),
    suffix: text('suffix'),
    nickname: text('nickname'),
    company: text('company'),
    jobTitle: text('job_title'),
    birthday: text('birthday'),
    noteMd: text('note_md').notNull().default(''),
    /** Per-contact optimistic-concurrency counter; bumped on every write (`If-Match`). */
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('contact_updated_at_idx').on(t.updatedAt)],
);

export const contactField = sqliteTable(
  'contact_field',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['phone', 'email', 'address', 'url'] }).notNull(),
    label: text('label').notNull(),
    value: text('value').notNull(),
    normalized: text('normalized').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    index('contact_field_contact_idx').on(t.contactId),
    index('contact_field_lookup_idx').on(t.kind, t.normalized),
  ],
);

export const tag = sqliteTable(
  'tag',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('tag_name_unique').on(t.name)],
);

export const contactTag = sqliteTable(
  'contact_tag',
  {
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] })],
);

export const customField = sqliteTable(
  'custom_field',
  {
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.key] })],
);

export const externalLink = sqliteTable(
  'external_link',
  {
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    system: text('system', { enum: ['icloud', 'google', 'obsidian'] }).notNull(),
    externalId: text('external_id').notNull(),
    etag: text('etag'),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.system, t.externalId] }),
    uniqueIndex('external_link_system_external_id_unique').on(t.system, t.externalId),
  ],
);

export const syncBase = sqliteTable(
  'sync_base',
  {
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    system: text('system', { enum: ['icloud', 'google', 'obsidian'] }).notNull(),
    /** Normalized snapshot as JSON text. */
    snapshot: text('snapshot').notNull(),
    hash: text('hash').notNull(),
    syncedAt: text('synced_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.system] })],
);

/** Insert-only: audit and undo. No foreign key so history outlives purged contacts. */
export const changeLog = sqliteTable(
  'change_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: text('ts').notNull(),
    actor: text('actor').notNull(),
    contactId: text('contact_id').notNull(),
    field: text('field').notNull(),
    before: text('before'),
    after: text('after'),
    operationId: text('operation_id').notNull(),
  },
  (t) => [
    index('change_log_contact_idx').on(t.contactId, t.ts),
    index('change_log_operation_idx').on(t.operationId),
  ],
);

export const conflict = sqliteTable(
  'conflict',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    system: text('system', { enum: ['icloud', 'google', 'obsidian'] }).notNull(),
    base: text('base'),
    hubValue: text('hub_value'),
    externalValue: text('external_value'),
    status: text('status', { enum: ['pending', 'resolved'] })
      .notNull()
      .default('pending'),
  },
  (t) => [index('conflict_status_idx').on(t.status)],
);

export const client = sqliteTable(
  'client',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['bridge-macos', 'obsidian'] }).notNull(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    cursor: text('cursor'),
    lastSeen: text('last_seen'),
    createdAt: text('created_at').notNull().default('1970-01-01T00:00:00.000Z'),
    /** Set when the token is revoked from the dashboard; revoked tokens never authenticate. */
    revokedAt: text('revoked_at'),
  },
  (t) => [uniqueIndex('client_token_hash_unique').on(t.tokenHash)],
);

/** Single dashboard administrator: code only ever writes the row with `id = 1` (BRV-025). */
export const adminUser = sqliteTable('admin_user', {
  id: integer('id').primaryKey(),
  /** argon2id PHC string. */
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
});

/** Dashboard sessions. Only the SHA-256 of the cookie value is stored. */
export const adminSession = sqliteTable(
  'admin_session',
  {
    idHash: text('id_hash').primaryKey(),
    csrfToken: text('csrf_token').notNull(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('admin_session_expires_idx').on(t.expiresAt)],
);
