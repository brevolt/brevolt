import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

export const DEFAULT_PHONE_REGION: CountryCode = 'ES';

export interface NormalizedPhone {
  /** E.164 (`+34600123456`), or the input kept as-is when it cannot be parsed. */
  normalized: string;
  /** True when the number could not be parsed; `normalized` is then the raw input. */
  unparsed: boolean;
}

export interface PhoneOptions {
  /** ISO 3166-1 alpha-2 region used for numbers without an international prefix. */
  defaultRegion?: CountryCode;
}

/**
 * Normalizes a phone number to E.164. Numbers that are not valid are kept
 * untouched and flagged `unparsed`, so nothing is invented or lost.
 * Idempotent: normalizing the `normalized` output returns the same output.
 */
export function normalizePhone(raw: string, options: PhoneOptions = {}): NormalizedPhone {
  const region = options.defaultRegion ?? DEFAULT_PHONE_REGION;
  const parsed = parsePhoneNumberFromString(raw, region);
  // Extensions have no E.164 representation: keep them as-is rather than drop digits.
  if (parsed?.isValid() && !parsed.ext) {
    return { normalized: parsed.number, unparsed: false };
  }
  return { normalized: raw, unparsed: true };
}
