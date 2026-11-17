import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpServer } from '../src/http.js';

const servers: ReturnType<typeof createHttpServer>[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function start(): Promise<string> {
  const server = createHttpServer();
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

describe('http server', () => {
  it('answers /healthz with ok', async () => {
    const res = await fetch(`${await start()}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 for unknown paths and 405 for other methods on /healthz', async () => {
    const base = await start();
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/healthz`, { method: 'POST' })).status).toBe(405);
  });
});
