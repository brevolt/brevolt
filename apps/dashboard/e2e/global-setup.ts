import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ContactService, buildApp, ensureAdmin, openDatabase, schema } from '@brevolt/server';

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
  const decisionTargets: string[] = [];
  for (let i = 0; i < SEED_COUNT; i++) {
    const n = String(i).padStart(4, '0');
    const created = service.create(
      {
        givenName: GIVEN[i % GIVEN.length] ?? null,
        familyNames: `${FAMILY[i % FAMILY.length] ?? ''} Seed${n}`,
        company: i % 3 === 0 ? `Synthetic Co ${n}` : null,
        fields: [{ kind: 'email', label: 'work', value: `seed${n}@example.test` }],
      },
      { actor: 'e2e-seed', operationId: `seed-${n}`, now },
    );
    if (i < 3) decisionTargets.push(created.id);
  }

  // One pending decision of each type, on the first seeded contacts (the contact count is unchanged).
  const [conflictContact, mergeContact, deletedContact] = decisionTargets as [
    string,
    string,
    string,
  ];
  const stamp = now.toISOString();
  database.db
    .insert(schema.conflict)
    .values({
      id: randomUUID(),
      contactId: conflictContact,
      field: 'company',
      system: 'icloud',
      base: JSON.stringify('Old Co'),
      hubValue: JSON.stringify('Hub Co'),
      externalValue: JSON.stringify('External Co'),
    })
    .run();
  database.db
    .insert(schema.proposal)
    .values([
      {
        id: randomUUID(),
        type: 'merge',
        system: 'google',
        contactId: mergeContact,
        externalId: 'e2e-google-1',
        externalSnapshot: JSON.stringify({
          prefix: null,
          givenName: null,
          middleName: null,
          familyNames: null,
          suffix: null,
          nickname: null,
          company: null,
          jobTitle: null,
          birthday: null,
          fields: [
            {
              kind: 'email',
              label: 'home',
              value: 'mario.external@example.test',
              normalized: 'mario.external@example.test',
            },
          ],
        }),
        reason: 'email:mario.external@example.test',
        createdAt: stamp,
      },
      {
        id: randomUUID(),
        type: 'deleted-upstream',
        system: 'icloud',
        contactId: deletedContact,
        createdAt: stamp,
      },
    ])
    .run();

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
