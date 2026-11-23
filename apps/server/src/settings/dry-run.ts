import { eq } from 'drizzle-orm';
import { setting } from '../db/schema.js';
import type { HubDatabase } from '../db/index.js';

type Reader = Pick<HubDatabase, 'select'>;

const key = (system: string): string => `dry_run:${system}`;

/** On unless explicitly turned off: a system's first connection is always a dry run. */
export function isDryRun(db: Reader, system: string): boolean {
  const row = db
    .select()
    .from(setting)
    .where(eq(setting.key, key(system)))
    .get();
  return row?.value !== 'off';
}

export function setDryRun(db: HubDatabase, system: string, enabled: boolean): void {
  const value = enabled ? 'on' : 'off';
  db.insert(setting)
    .values({ key: key(system), value })
    .onConflictDoUpdate({ target: setting.key, set: { value } })
    .run();
}
