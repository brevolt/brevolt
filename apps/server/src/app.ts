import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { HubDatabase } from './db/index.js';
import { tokenAuthPlugin } from './auth/plugin.js';
import { changeRoutes } from './changes/routes.js';
import { contactRoutes } from './contacts/routes.js';
import { dashboardAuthPlugin } from './auth/dashboard.js';
import { settingsRoutes } from './settings/routes.js';

export interface AppOptions {
  db: HubDatabase;
  now?: () => Date;
}

/** Status of one external system. Adapters register themselves here in later phases. */
export type AdapterStatus = 'ok' | 'degraded' | 'down';

/** `GET /healthz`: 200 when the hub is serving and its database answers, 503 otherwise. */
export function buildApp(
  opts: AppOptions,
  adapters: () => Record<string, AdapterStatus> = () => ({}),
): FastifyInstance {
  const app = Fastify();
  const now = opts.now ?? (() => new Date());

  app.get('/healthz', (_request, reply) => {
    let database: 'ok' | 'down' = 'ok';
    try {
      opts.db.run(sql`SELECT 1`);
    } catch {
      database = 'down';
    }
    return reply
      .code(database === 'ok' ? 200 : 503)
      .header('Cache-Control', 'no-store')
      .send({
        status: database === 'ok' ? 'ok' : 'down',
        database,
        adapters: adapters(),
        time: now().toISOString(),
      });
  });

  void app.register(tokenAuthPlugin, { db: opts.db, now });
  void app.register(dashboardAuthPlugin, { db: opts.db, now });
  void app.register(settingsRoutes, { db: opts.db, adapters, now });
  void app.register(contactRoutes, { db: opts.db, now });
  void app.register(changeRoutes, { db: opts.db, now });
  return app;
}
