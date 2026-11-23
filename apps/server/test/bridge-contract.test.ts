import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bridgeAckRequestSchema,
  bridgeChangesRequestSchema,
  bridgePendingResponseSchema,
} from '@brevolt/contracts';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../packages/contracts/fixtures/bridge/${name}`, import.meta.url),
      'utf8',
    ),
  );

describe('bridge contract fixtures', () => {
  it('parses an incoming batch', () => {
    const parsed = bridgeChangesRequestSchema.parse(fixture('changes-upsert.json'));
    expect(parsed.changes).toHaveLength(2);
    expect(parsed.changes[0]?.contact?.birthday).toBeNull();
  });
  it('parses a pending response', () => {
    expect(
      bridgePendingResponseSchema.parse(fixture('pending-response.json')).changes,
    ).toHaveLength(1);
  });
  it('parses an ack request', () => {
    expect(bridgeAckRequestSchema.parse(fixture('ack-request.json')).acks).toHaveLength(2);
  });
  it('rejects an upsert without contact and unknown keys', () => {
    const base = { operation_id: 'a', local_id: 'x', container_id: 'c' };
    expect(
      bridgeChangesRequestSchema.safeParse({ changes: [{ ...base, kind: 'upsert' }] }).success,
    ).toBe(false);
    expect(
      bridgeChangesRequestSchema.safeParse({ changes: [{ ...base, kind: 'delete', extra: 1 }] })
        .success,
    ).toBe(false);
  });
});
