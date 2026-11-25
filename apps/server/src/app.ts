import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { HubDatabase } from './db/index.js';
import { tokenAuthPlugin } from './auth/plugin.js';
import { changeRoutes } from './changes/routes.js';
import { bridgeRoutes } from './bridge/routes.js';
import { decisionRoutes } from './bridge/decision-routes.js';
import { contactRoutes } from './contacts/routes.js';
import { dashboardAuthPlugin } from './auth/dashboard.js';
import { dashboardStaticRoutes } from './dashboard/static.js';
import { settingsRoutes } from './settings/routes.js';

export interface AppOptions {
  db: HubDatabase;
  now?: () => Date;
  /** Built dashboard directory. When set, the dashboard SPA is served behind the session login. */
  dashboardDir?: string;
  /** Running version reported by `/healthz`; defaults to `dev`. */
  version?: string;
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
        version: opts.version ?? 'dev',
        database,
        adapters: adapters(),
        time: now().toISOString(),
      });
  });

  void app.register(tokenAuthPlugin, { db: opts.db, now });
  void app.register(dashboardAuthPlugin, { db: opts.db, now, serveHome: !opts.dashboardDir });
  void app.register(settingsRoutes, { db: opts.db, adapters, now });
  void app.register(contactRoutes, { db: opts.db, now });
  void app.register(changeRoutes, { db: opts.db, now });
  void app.register(bridgeRoutes, { db: opts.db, now });
  void app.register(decisionRoutes, { db: opts.db, now });
  if (opts.dashboardDir) void app.register(dashboardStaticRoutes, { dir: opts.dashboardDir });
  return app;
}
