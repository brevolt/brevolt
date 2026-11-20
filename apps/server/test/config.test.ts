import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const valid = {
  DATABASE_PATH: '/data/brevolt.db',
  ENCRYPTION_KEY: KEY,
  GOOGLE_CLIENT_ID: 'client-id-placeholder',
  GOOGLE_CLIENT_SECRET: 'client-secret-placeholder',
};

function failure(
  env: Record<string, string | undefined>,
  files: Record<string, string> = {},
): ConfigError {
  try {
    loadConfig(env, (p) => {
      const c = files[p];
      if (c === undefined) throw new Error('ENOENT');
      return c;
    });
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return e as ConfigError;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('loads a valid configuration with defaults', () => {
    const c = loadConfig(valid);
    expect(c.encryptionKey.length).toBe(32);
    expect(c).toMatchObject({
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      databasePath: '/data/brevolt.db',
      version: 'dev',
    });
  });

  it('reads the running version from BREVOLT_VERSION', () => {
    expect(loadConfig({ ...valid, BREVOLT_VERSION: '0.3.1' }).version).toBe('0.3.1');
  });

  it.each(['ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DATABASE_PATH'])(
    'fails when %s is missing',
    (name) => {
      const err = failure({ ...valid, [name]: undefined });
      expect(err.issues.map((i) => i.variable)).toEqual([name]);
      expect(err.message).toContain(name);
    },
  );

  it('treats an empty secret as missing', () => {
    expect(failure({ ...valid, GOOGLE_CLIENT_SECRET: '' }).issues[0]?.variable).toBe(
      'GOOGLE_CLIENT_SECRET',
    );
  });

  it('reports every problem at once', () => {
    expect(failure({}).issues.length).toBe(4);
  });

  it('rejects an ENCRYPTION_KEY shorter than 32 bytes without echoing it', () => {
    const short = Buffer.alloc(31, 9).toString('base64');
    const err = failure({ ...valid, ENCRYPTION_KEY: short });
    expect(err.issues[0]?.message).toMatch(/at least 32 bytes/);
    expect(err.message).not.toContain(short);
  });

  it('rejects an ENCRYPTION_KEY that is not base64 without echoing it', () => {
    const bad = 'not base64 !!! secret-value';
    const err = failure({ ...valid, ENCRYPTION_KEY: bad });
    expect(err.message).not.toContain('secret-value');
    expect(err.issues[0]?.variable).toBe('ENCRYPTION_KEY');
  });

  it('reads secrets from *_FILE variants and strips the trailing newline', () => {
    const c = loadConfig(
      {
        ...valid,
        ENCRYPTION_KEY: undefined,
        ENCRYPTION_KEY_FILE: '/run/secrets/key',
        GOOGLE_CLIENT_SECRET: undefined,
        GOOGLE_CLIENT_SECRET_FILE: '/run/secrets/s',
      },
      (p) => (p === '/run/secrets/key' ? `${KEY}\n` : 'from-file\n'),
    );
    expect(c.encryptionKey.length).toBe(32);
    expect(c.googleClientSecret).toBe('from-file');
  });

  it('fails when a *_FILE cannot be read, without leaking the path content', () => {
    const err = failure({ ...valid, ENCRYPTION_KEY: undefined, ENCRYPTION_KEY_FILE: '/missing' });
    expect(err.issues).toEqual([
      { variable: 'ENCRYPTION_KEY_FILE', message: 'file could not be read' },
    ]);
  });

  it('fails when a *_FILE is empty', () => {
    const err = failure(
      { ...valid, ENCRYPTION_KEY: undefined, ENCRYPTION_KEY_FILE: '/e' },
      { '/e': '\n' },
    );
    expect(err.issues[0]?.variable).toBe('ENCRYPTION_KEY');
  });

  it('fails when both NAME and NAME_FILE are set', () => {
    const err = failure({ ...valid, GOOGLE_CLIENT_ID_FILE: '/f' }, { '/f': 'x' });
    expect(err.issues[0]?.message).toMatch(/only one/);
  });

  it.each([
    [{ PORT: 'abc' }, 'PORT'],
    [{ PORT: '70000' }, 'PORT'],
    [{ LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'],
    [{ PUBLIC_URL: 'not a url' }, 'PUBLIC_URL'],
  ])('rejects invalid optional settings %j', (extra, variable) => {
    expect(failure({ ...valid, ...extra }).issues.map((i) => i.variable)).toContain(variable);
  });

  it('never includes secret values in any error message', () => {
    const err = failure({ ...valid, ENCRYPTION_KEY: 'short', PORT: 'x' });
    for (const v of ['client-id-placeholder', 'client-secret-placeholder', 'short']) {
      expect(err.message).not.toContain(v);
    }
  });
});

describe('empty optional variables', () => {
  it('treats an empty PUBLIC_URL as unset', () => {
    expect(loadConfig({ ...valid, PUBLIC_URL: '' }).publicUrl).toBeUndefined();
  });

  it('treats an empty BREVOLT_VERSION as dev', () => {
    expect(loadConfig({ ...valid, BREVOLT_VERSION: '' }).version).toBe('dev');
  });
});
