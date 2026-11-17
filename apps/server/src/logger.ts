export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const REDACTED = '[REDACTED]';

/** Keys whose values are always redacted, whatever they contain (compared lowercase, no separators). */
const SENSITIVE_KEY_PARTS = [
  'phone',
  'telephone',
  'mobile',
  'email',
  'mail',
  'name',
  'nickname',
  'address',
  'birthday',
  'note',
  'organization',
  'company',
  'token',
  'secret',
  'password',
  'passwd',
  'authorization',
  'cookie',
  'apikey',
  'privatekey',
  'encryptionkey',
  'credential',
  'clientid',
  'contact',
  'payload',
  'fields',
  'value',
  'values',
];

/** Value patterns redacted inside any string, even under harmless keys or in messages. */
const VALUE_PATTERNS: readonly RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, // email
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, // auth header values
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, // JWT
  /\b(?:ya29\.|1\/\/)[A-Za-z0-9._-]{10,}/g, // Google access / refresh tokens
  /\b[A-Za-z0-9_-]{32,}\b/g, // long opaque tokens / keys
  /\+?\d[\d\s().-]{5,}\d/g, // phone-like digit runs
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const k = normalizeKey(key);
  return SENSITIVE_KEY_PARTS.some((p) => k.includes(p));
}

export function redactString(input: string): string {
  let out = input;
  for (const re of VALUE_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
  }
  if (depth > 8 || seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) {
    // Message and stack may carry personal data; the class name is kept for diagnosis.
    return {
      name: value.name,
      message: redactString(value.message),
      stack: redactString(value.stack ?? ''),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Receives one JSON line per record. Defaults to stdout. */
  write?: (line: string) => void;
  now?: () => Date;
  bindings?: Record<string, unknown>;
}

/** Structured JSON logger. Redaction happens on every record at every level, debug included (R-SEC-9). */
export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVELS[options.level ?? 'info'];
  const write =
    options.write ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};

  const log = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVELS[level] < threshold) return;
    const record = {
      ...(redact({ ...bindings, ...fields }) as Record<string, unknown>),
      time: now().toISOString(),
      level,
      msg: redactString(msg),
    };
    write(JSON.stringify(record));
  };

  return {
    debug: (m, f) => {
      log('debug', m, f);
    },
    info: (m, f) => {
      log('info', m, f);
    },
    warn: (m, f) => {
      log('warn', m, f);
    },
    error: (m, f) => {
      log('error', m, f);
    },
    child: (b) => createLogger({ ...options, bindings: { ...bindings, ...b } }),
  };
}
