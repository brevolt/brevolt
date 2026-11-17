import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ContactService, buildApp, ensureAdmin, openDatabase } from '@brevolt/server';

/** Total synthetic contacts: the acceptance criterion is a usable UI with 5,000. */
export const SEED_COUNT = 5000;

const GIVEN = ['Ada', 'Alan', 'Grace', 'Linus', 'Edsger', 'Margaret', 'Barbara', 'Donald'];
const FAMILY = ['Lovelace', 'Turing', 'Hopper', 'Dijkstra', 'Hamilton', 'Liskov', 'Knuth'];

/**
 * Starts the real server (real SQLite file, real login, built dashboard) in this process
 * with a throwaway database and a random admin password, then stops it afterwards.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const dir = mkdtempSync(join(tmpdir(), 'brevolt-e2e-'));
  const database = openDatabase({ path: join(dir, 'e2e.db') });
  const password = randomBytes(18).toString('base64url');
  await ensureAdmin(database.db, password);

  const service = new ContactService(database.db);
  const now = new Date();
  for (let i = 0; i < SEED_COUNT; i++) {
    const n = String(i).padStart(4, '0');
    service.create(
      {
        givenName: GIVEN[i % GIVEN.length] ?? null,
        familyNames: `${FAMILY[i % FAMILY.length] ?? ''} Seed${n}`,
        company: i % 3 === 0 ? `Synthetic Co ${n}` : null,
        fields: [{ kind: 'email', label: 'work', value: `seed${n}@example.test` }],
      },
      { actor: 'e2e-seed', operationId: `seed-${n}`, now },
    );
  }

  const app = buildApp({
    db: database.db,
    dashboardDir: resolve(import.meta.dirname, '../dist'),
  });
  const port = Number(process.env.E2E_PORT ?? 4318);
  await app.listen({ host: '127.0.0.1', port });
  process.env.E2E_ADMIN_PASSWORD = password;

  return async () => {
    await app.close();
    database.close();
    rmSync(dir, { recursive: true, force: true });
  };
}
