import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** Secrets that must be provided and never have a default (R-SEC-1, R-SEC-4). */
const SECRET_VARS = [
  'ENCRYPTION_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'ADMIN_PASSWORD',
] as const;

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

export const MIN_ENCRYPTION_KEY_BYTES = 32;

export interface ConfigIssue {
  /** Environment variable name. Never contains a value. */
  readonly variable: string;
  readonly message: string;
}

/** Thrown when the configuration is invalid. Messages never include values. */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      `Invalid configuration:\n${issues.map((i) => `  - ${i.variable}: ${i.message}`).join('\n')}`,
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export interface Config {
  readonly databasePath: string;
  readonly encryptionKey: Buffer;
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  /** Initial dashboard admin password; only used on first startup, when no admin exists yet. */
  readonly adminPassword: string | undefined;
  readonly publicUrl: string | undefined;
  /** Directory with the built dashboard; the dashboard is not served when unset. */
  readonly dashboardDir: string | undefined;
  readonly host: string;
  readonly port: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Running version: the release (e.g. `0.3.1`) baked into the image, or `dev` for any other build. */
  readonly version: string;
}

export type ReadFile = (path: string) => string;

const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

const schema = z.object({
  DATABASE_PATH: z.string({ error: 'is required' }).min(1, 'is required'),
  ENCRYPTION_KEY: z
    .string({ error: 'is required' })
    .min(1, 'is required')
    .refine((v) => BASE64.test(v), 'must be base64 encoded')
    .transform((v) => Buffer.from(v, 'base64'))
    .refine(
      (b) => b.length >= MIN_ENCRYPTION_KEY_BYTES,
      `must decode to at least ${String(MIN_ENCRYPTION_KEY_BYTES)} bytes`,
    ),
  GOOGLE_CLIENT_ID: z.string({ error: 'is required' }).min(1, 'is required'),
  GOOGLE_CLIENT_SECRET: z.string({ error: 'is required' }).min(1, 'is required'),
  ADMIN_PASSWORD: z
    .string()
    .min(
      MIN_ADMIN_PASSWORD_LENGTH,
      `must be at least ${String(MIN_ADMIN_PASSWORD_LENGTH)} characters`,
    )
    .optional(),
  PUBLIC_URL: z.url({ error: 'must be a valid URL' }).optional(),
  DASHBOARD_DIR: z.string().min(1).optional(),
  HOST: z.string().min(1, 'must not be empty').default('127.0.0.1'),
  PORT: z
    .string()
    .regex(/^\d+$/, 'must be an integer')
    .transform(Number)
    .refine((n) => n >= 1 && n <= 65535, 'must be between 1 and 65535')
    .default(3000),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'], { error: 'must be debug, info, warn or error' })
    .default('info'),
  BREVOLT_VERSION: z.string().default('dev'),
});

/**
 * Resolves each secret from `NAME` or `NAME_FILE` (Docker secrets). Empty values count as missing.
 * Returns the raw environment with file contents merged in, plus any resolution issues.
 */
function resolveEnv(
  env: Readonly<Record<string, string | undefined>>,
  readFile: ReadFile,
): { values: Record<string, string | undefined>; issues: ConfigIssue[] } {
  const values: Record<string, string | undefined> = { ...env };
  const issues: ConfigIssue[] = [];
  for (const name of SECRET_VARS) {
    const direct = env[name];
    const filePath = env[`${name}_FILE`];
    const hasDirect = direct !== undefined && direct !== '';
    const hasFile = filePath !== undefined && filePath !== '';
    if (hasDirect && hasFile) {
      issues.push({
        variable: name,
        message: `set both as ${name} and ${name}_FILE; use only one`,
      });
      values[name] = undefined;
    } else if (hasFile) {
      try {
        // Strip the trailing newline most secret files carry.
        values[name] = readFile(filePath).replace(/\r?\n$/, '');
      } catch {
        issues.push({ variable: `${name}_FILE`, message: 'file could not be read' });
        values[name] = undefined;
      }
    }
    if (values[name] === '') values[name] = undefined;
  }
  // Compose passes unset optional variables as empty strings.
  for (const name of ['DATABASE_PATH', 'PUBLIC_URL', 'DASHBOARD_DIR', 'BREVOLT_VERSION']) {
    if (values[name] === '') values[name] = undefined;
  }
  return { values, issues };
}

/**
 * Loads and validates the configuration. Throws `ConfigError` listing every problem by
 * variable name; values are never included in messages.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  readFile: ReadFile = (p) => readFileSync(p, 'utf8'),
): Config {
  const { values, issues } = resolveEnv(env, readFile);
  const failed = new Set(issues.map((i) => i.variable));
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const variable = String(issue.path[0] ?? 'config');
      if (failed.has(variable) || failed.has(`${variable}_FILE`)) continue;
      issues.push({ variable, message: issue.message });
    }
  }
  if (issues.length > 0 || !parsed.success) throw new ConfigError(issues);

  const d = parsed.data;
  return Object.freeze({
    databasePath: d.DATABASE_PATH,
    encryptionKey: d.ENCRYPTION_KEY,
    googleClientId: d.GOOGLE_CLIENT_ID,
    googleClientSecret: d.GOOGLE_CLIENT_SECRET,
    adminPassword: d.ADMIN_PASSWORD,
    publicUrl: d.PUBLIC_URL,
    dashboardDir: d.DASHBOARD_DIR,
    host: d.HOST,
    port: d.PORT,
    logLevel: d.LOG_LEVEL,
    version: d.BREVOLT_VERSION,
  });
}
