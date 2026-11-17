import { eq } from 'drizzle-orm';
import { DEFAULT_PHONE_REGION, type PhoneOptions } from '@brevolt/core';
import { setting } from '../db/schema.js';
import type { HubDatabase } from '../db/index.js';

type Region = NonNullable<PhoneOptions['defaultRegion']>;
type Reader = Pick<HubDatabase, 'select'>;

const PHONE_REGION_KEY = 'phone_region';
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

/** True for an uppercase ISO 3166-1 alpha-2 code that names a real region. */
export function isValidRegion(value: string): boolean {
  if (!/^[A-Z]{2}$/.test(value)) return false;
  const name = regionNames.of(value);
  // ICU names unassigned codes such as ZZ "Unknown Region" instead of rejecting them.
  return name !== undefined && name !== 'Unknown Region';
}

/** Default region for phones without an international prefix; falls back to the built-in default. */
export function getPhoneRegion(db: Reader): Region {
  const row = db.select().from(setting).where(eq(setting.key, PHONE_REGION_KEY)).get();
  return row && isValidRegion(row.value) ? (row.value as Region) : DEFAULT_PHONE_REGION;
}

/** Returns false (and stores nothing) when the code is not a valid region. */
export function setPhoneRegion(db: HubDatabase, value: string): boolean {
  const region = value.trim().toUpperCase();
  if (!isValidRegion(region)) return false;
  db.insert(setting)
    .values({ key: PHONE_REGION_KEY, value: region })
    .onConflictDoUpdate({ target: setting.key, set: { value: region } })
    .run();
  return true;
}
