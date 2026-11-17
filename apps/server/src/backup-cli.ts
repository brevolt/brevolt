import { backupDatabase, DEFAULT_RETENTION_DAYS, pruneBackups } from './backup.js';
import { createLogger } from './logger.js';

function positive(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    process.stderr.write(`${name}: must be a positive number\n`);
    process.exit(1);
  }
  return n;
}

const databasePath = process.env['DATABASE_PATH'];
const backupDir = process.env['BACKUP_DIR'];
if (!databasePath || !backupDir) {
  process.stderr.write('DATABASE_PATH and BACKUP_DIR are required\n');
  process.exit(1);
}
const retentionDays = positive('BACKUP_RETENTION_DAYS', DEFAULT_RETENTION_DAYS);
const intervalHours = positive('BACKUP_INTERVAL_HOURS', 24);
const once = process.argv.includes('--once');
const logger = createLogger();

function run(): void {
  try {
    backupDatabase(databasePath as string, backupDir as string);
    const removed = pruneBackups(backupDir as string, retentionDays);
    logger.info('backup completed', { pruned: removed.length });
  } catch (error) {
    logger.error('backup failed', { error });
    if (once) process.exit(1);
  }
}

run();
if (!once) {
  setInterval(run, intervalHours * 60 * 60 * 1000);
}
