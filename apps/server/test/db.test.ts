import Database from 'better-sqlite3';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MIGRATIONS_FOLDER, openDatabase, schema } from '../src/db/index.js';

const TABLES = [
  'admin_session',
  'admin_user',
  'bridge_operation',
  'bridge_pending',
  'change_log',
  'client',
  'conflict',
  'contact',
  'contact_field',
  'contact_tag',
  'custom_field',
  'external_link',
  'proposal',
  'setting',
  'sync_base',
  'tag',
];

const A = '01900000-0000-7000-8000-000000000001';
const B = '01900000-0000-7000-8000-000000000002';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brevolt-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tableNames(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

/** Copy of the real migrations, optionally truncated to the first `count` entries. */
function migrationsCopy(name: string, count?: number): string {
  const target = join(dir, name);
  cpSync(DEFAULT_MIGRATIONS_FOLDER, target, { recursive: true });
  if (count !== undefined) {
    const journalPath = join(target, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, count);
    writeFileSync(journalPath, JSON.stringify(journal));
  }
  return target;
}

function seed(sqlite: Database.Database): void {
  const now = '2026-01-01T00:00:00.000Z';
  sqlite
    .prepare(
      'INSERT INTO contact (id, given_name, note_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(A, 'Ada', '', now, now);
  sqlite
    .prepare(
      'INSERT INTO external_link (contact_id, system, external_id, etag) VALUES (?, ?, ?, ?)',
    )
    .run(A, 'google', 'people/1', null);
}

describe('database migrations', () => {
  it('applies every migration on an empty database and creates all spec tables in WAL mode', () => {
    const path = join(dir, 'hub.db');
    const opened = openDatabase({ path });
    expect(tableNames(opened.sqlite)).toEqual(TABLES);
    expect(opened.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(opened.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(opened.backupPath).toBeNull();
    opened.close();
  });

  it('is idempotent: reopening applies nothing and makes no backup', () => {
    const path = join(dir, 'hub.db');
    openDatabase({ path }).close();
    const again = openDatabase({ path });
    expect(again.backupPath).toBeNull();
    expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toEqual([]);
    again.close();
  });

  it.each([0, 1, 2, 3])(
    'upgrades a database created by the first %i migration(s), keeping data',
    (previous) => {
      const path = join(dir, 'hub.db');
      const old = migrationsCopy('old', previous);
      const prev = openDatabase({ path, migrationsFolder: old });
      if (previous > 0) seed(prev.sqlite);
      prev.close();

      const upgraded = openDatabase({ path });
      if (previous > 0) {
        const row = upgraded.sqlite
          .prepare('SELECT given_name AS n FROM contact WHERE id = ?')
          .get(A);
        expect(row).toEqual({ n: 'Ada' });
      }
      expect(tableNames(upgraded.sqlite)).toEqual(TABLES);
      upgraded.close();
    },
  );

  it('applies a new migration over existing data after copying the database first', () => {
    const path = join(dir, 'hub.db');
    openDatabase({ path }).close();
    const seeded = openDatabase({ path });
    seed(seeded.sqlite);
    seeded.close();

    // Simulate the next version: the real migrations plus one more.
    const next = migrationsCopy('next');
    const journalPath = join(next, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
    };
    const last = journal.entries.at(-1);
    if (!last) throw new Error('no migrations');
    journal.entries.push({
      ...last,
      idx: last.idx + 1,
      when: last.when + 1000,
      tag: '9999_add_column',
    });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(join(next, '9999_add_column.sql'), 'ALTER TABLE `contact` ADD `extra` text;');

    const backups: string[] = [];
    const upgraded = openDatabase({
      path,
      migrationsFolder: next,
      onBackup: (p) => backups.push(p),
    });
    expect(upgraded.backupPath).not.toBeNull();
    expect(backups).toEqual([upgraded.backupPath]);
    expect(upgraded.sqlite.prepare('SELECT extra FROM contact WHERE id = ?').get(A)).toEqual({
      extra: null,
    });
    upgraded.close();

    // The copy has the pre-migration state: data present, new column absent.
    const bak = new Database(upgraded.backupPath ?? '', { readonly: true });
    expect(bak.prepare('SELECT given_name AS n FROM contact').all()).toEqual([{ n: 'Ada' }]);
    expect(() => bak.prepare('SELECT extra FROM contact').all()).toThrow();
    bak.close();
  });

  it('does not leave a half-migrated database or lose the backup if a migration fails', () => {
    const path = join(dir, 'hub.db');
    const first = openDatabase({ path });
    seed(first.sqlite);
    first.close();

    const broken = migrationsCopy('broken');
    const journalPath = join(broken, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const last = journal.entries.at(-1);
    if (!last) throw new Error('no migrations');
    journal.entries.push({
      ...last,
      idx: last.idx + 1,
      when: last.when + 1000,
      tag: '9999_broken',
    });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(join(broken, '9999_broken.sql'), 'ALTER TABLE `missing` ADD `x` text;');

    expect(() => openDatabase({ path, migrationsFolder: broken })).toThrow();
    expect(readdirSync(dir).some((f) => f.includes('.pre-migration-'))).toBe(true);
    const check = openDatabase({ path });
    expect(check.sqlite.prepare('SELECT count(*) AS c FROM contact').get()).toEqual({ c: 1 });
    check.close();
  });
});

describe('constraints', () => {
  it('enforces unique (system, external_id) across contacts but allows the same id in another system', () => {
    const opened = openDatabase({ path: ':memory:' });
    const now = '2026-01-01T00:00:00.000Z';
    opened.db
      .insert(schema.contact)
      .values([
        { id: A, createdAt: now, updatedAt: now },
        { id: B, createdAt: now, updatedAt: now },
      ])
      .run();
    opened.db
      .insert(schema.externalLink)
      .values({ contactId: A, system: 'google', externalId: 'x' })
      .run();
    expect(() =>
      opened.db
        .insert(schema.externalLink)
        .values({ contactId: B, system: 'google', externalId: 'x' })
        .run(),
    ).toThrow(/UNIQUE/);
    opened.db
      .insert(schema.externalLink)
      .values({ contactId: B, system: 'icloud', externalId: 'x' })
      .run();
    opened.close();
  });

  it('cascades contact deletion to its dependent rows but keeps change_log', () => {
    const opened = openDatabase({ path: ':memory:' });
    const now = '2026-01-01T00:00:00.000Z';
    opened.db.insert(schema.contact).values({ id: A, createdAt: now, updatedAt: now }).run();
    opened.db
      .insert(schema.contactField)
      .values({ id: B, contactId: A, kind: 'phone', label: 'mobile', value: '1', normalized: '+1' })
      .run();
    opened.db
      .insert(schema.changeLog)
      .values({
        ts: now,
        actor: 'client:test',
        contactId: A,
        field: 'given_name',
        operationId: 'op-1',
      })
      .run();
    opened.sqlite.prepare('DELETE FROM contact WHERE id = ?').run(A);
    expect(opened.db.select().from(schema.contactField).all()).toHaveLength(0);
    expect(opened.db.select().from(schema.changeLog).all()).toHaveLength(1);
    opened.close();
  });
});
