import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';

function capture(level: 'debug' | 'info' = 'debug') {
  const lines: string[] = [];
  return {
    lines,
    log: createLogger({
      level,
      write: (l) => {
        lines.push(l);
      },
      now: () => new Date(0),
    }),
  };
}

const contact = {
  id: 'c-1',
  displayName: 'Ada Lovelace',
  givenName: 'Ada',
  phones: [{ type: 'mobile', number: '+34 612 345 678' }],
  emails: ['ada.lovelace@example.com'],
  addresses: [{ street: '12 Analytical St' }],
  organization: 'Analytical Engines Ltd',
  notes: 'Met at the conference',
};
const PERSONAL = ['Ada', 'Lovelace', '612', '345', 'example.com', 'Analytical', 'conference'];

describe('logger redaction', () => {
  it.each(['debug', 'info'] as const)(
    'logs a full contact without any personal data (level %s)',
    (level) => {
      const { lines, log } = capture('debug');
      log[level]('processing contact', { contact });
      log[level]('flat fields', { ...contact });
      const out = lines.join('\n');
      for (const p of PERSONAL) expect(out).not.toContain(p);
      expect(out).toContain('c-1');
    },
  );

  it('redacts personal data embedded in messages and errors', () => {
    const { lines, log } = capture();
    log.error('failed for ada@example.com', {
      err: new Error('bad phone +34 612 345 678 for Bearer abc.def.ghi'),
    });
    const out = lines.join('\n');
    expect(out).not.toContain('ada@example.com');
    expect(out).not.toContain('612');
    expect(out).not.toContain('abc.def.ghi');
  });

  it('redacts tokens under any key and by value shape', () => {
    const { lines, log } = capture();
    const token = 'A'.repeat(20) + 'b'.repeat(24);
    log.info(`header Authorization: Bearer ${token}`, {
      authorization: `Bearer ${token}`,
      refresh_token: 'x',
      note: token,
      harmless: token,
    });
    expect(lines.join('\n')).not.toContain(token);
  });

  it('keeps non-sensitive data, applies level filtering and bindings', () => {
    const { lines, log } = capture('info');
    log.debug('hidden');
    log.child({ component: 'sync' }).info('started', { count: 3 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      component: 'sync',
      count: 3,
      time: '1970-01-01T00:00:00.000Z',
      level: 'info',
      msg: 'started',
    });
  });

  it('handles circular structures', () => {
    const { lines, log } = capture();
    const a: Record<string, unknown> = { id: 1 };
    a['self'] = a;
    expect(() => {
      log.info('x', a);
    }).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});
