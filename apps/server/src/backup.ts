import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PREFIX = 'brevolt-';
const SUFFIX = '.db';
/** brevolt-YYYYMMDDTHHMMSSZ.db */
const NAME = /^brevolt-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/;

export const DEFAULT_RETENTION_DAYS = 30;

export function backupFileName(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return `${PREFIX}${stamp}${SUFFIX}`;
}

function parseBackupDate(name: string): Date | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const [, y = '', mo = '', d = '', h = '', mi = '', s = ''] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
}

/** Writes a consistent copy (WAL included) of the database with `VACUUM INTO`. Returns its path. */
export function backupDatabase(sourcePath: string, backupDir: string, now = new Date()): string {
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, backupFileName(now));
  const partial = `${target}.partial`;
  rmSync(partial, { force: true });
  const sqlite = new Database(sourcePath, { fileMustExist: true });
  try {
    sqlite.pragma('busy_timeout = 5000');
    sqlite.prepare('VACUUM INTO ?').run(partial);
  } finally {
    sqlite.close();
  }
  // Rename last so a half-written copy is never mistaken for a backup.
  renameSync(partial, target);
  return target;
}

/** Deletes backups older than `retentionDays`. Only files with the backup name pattern are touched. */
export function pruneBackups(
  backupDir: string,
  retentionDays = DEFAULT_RETENTION_DAYS,
  now = new Date(),
): string[] {
  const limit = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const name of readdirSync(backupDir)) {
    const date = parseBackupDate(name);
    if (date && date.getTime() < limit) {
      rmSync(join(backupDir, name), { force: true });
      removed.push(name);
    }
  }
  return removed.sort();
}
