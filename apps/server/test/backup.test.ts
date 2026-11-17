import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDatabase, backupFileName, pruneBackups } from '../src/backup.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brevolt-backup-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('backup', () => {
  it('creates a consistent, restorable copy including WAL content', () => {
    const src = join(dir, 'src.db');
    const db = new Database(src);
    db.pragma('journal_mode = WAL');
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('hello')");
    const out = backupDatabase(src, join(dir, 'backups'), new Date('2026-01-02T03:04:05Z'));
    db.close();
    expect(out.endsWith('brevolt-20260102T030405Z.db')).toBe(true);
    const copy = new Database(out, { readonly: true });
    expect(copy.prepare('SELECT v FROM t').all()).toEqual([{ v: 'hello' }]);
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    copy.close();
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
  });

  it('prunes only backups older than the retention', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    const old = backupFileName(new Date('2026-01-20T00:00:00Z'));
    const edge = backupFileName(new Date('2026-02-02T00:00:00Z'));
    const recent = backupFileName(new Date('2026-02-28T00:00:00Z'));
    for (const n of [old, edge, recent, 'unrelated.txt']) writeFileSync(join(dir, n), '');
    expect(pruneBackups(dir, 30, now)).toEqual([old]);
    expect(readdirSync(dir).sort()).toEqual([edge, recent, 'unrelated.txt'].sort());
  });
});
