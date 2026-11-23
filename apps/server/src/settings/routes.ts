import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from 'fastify';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { SCOPE_BY_KIND, createClientToken, revokeClientToken } from '../auth/tokens.js';
import { client } from '../db/schema.js';
import type { HubDatabase } from '../db/index.js';
import type { AdapterStatus } from '../app.js';
import { BridgeSync } from '../bridge/sync.js';
import { isDryRun, setDryRun } from './dry-run.js';
import { getPhoneRegion, setPhoneRegion } from './settings.js';

export interface SettingsRoutesOptions {
  db: HubDatabase;
  /** Status of each external system, as reported by its adapter. */
  adapters?: () => Record<string, AdapterStatus>;
  now?: () => Date;
}

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['bridge-macos', 'obsidian']),
});
const regionBody = z.object({ region: z.string() });
const dryRunBody = z.object({ enabled: z.boolean(), confirm: z.boolean().optional() });
const idParams = z.object({ id: z.uuid() });

const routes: FastifyPluginCallback<SettingsRoutesOptions> = (app: FastifyInstance, opts, done) => {
  const now = opts.now ?? (() => new Date());
  const json = (reply: FastifyReply): FastifyReply => reply.header('Cache-Control', 'no-store');

  app.get('/api/settings', (_request, reply) => {
    const tokens = opts.db
      .select()
      .from(client)
      .orderBy(desc(client.createdAt))
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        scope: SCOPE_BY_KIND[r.kind],
        createdAt: r.createdAt,
        lastSeen: r.lastSeen,
        revokedAt: r.revokedAt,
      }));
    return json(reply).send({
      tokens,
      region: getPhoneRegion(opts.db),
      systems: opts.adapters?.() ?? {},
    });
  });

  app.post('/api/settings/tokens', (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const created = createClientToken(opts.db, body.data, now());
    return json(reply).code(201).send({
      id: created.id,
      name: created.name,
      kind: created.kind,
      scope: SCOPE_BY_KIND[created.kind],
      token: created.token,
    });
  });

  app.post('/api/settings/tokens/:id/revoke', (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    revokeClientToken(opts.db, params.data.id, now());
    return json(reply).send({ ok: true });
  });

  const sync = new BridgeSync(opts.db, now);
  const dryRunState = () => ({
    system: 'icloud',
    dryRun: isDryRun(opts.db, 'icloud'),
    diff: sync.diff(),
  });

  app.get('/api/sync/icloud', (_request, reply) => json(reply).send(dryRunState()));

  app.put('/api/sync/icloud/dry-run', (request, reply) => {
    const body = dryRunBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    // Leaving dry-run lets the bridge write to the real address book: ask for confirmation.
    if (!body.data.enabled && body.data.confirm !== true) {
      return reply.code(409).send({ error: 'confirmation_required' });
    }
    setDryRun(opts.db, 'icloud', body.data.enabled);
    return json(reply).send(dryRunState());
  });

  app.put('/api/settings/region', (request, reply) => {
    const body = regionBody.safeParse(request.body);
    if (!body.success || !setPhoneRegion(opts.db, body.data.region)) {
      return reply.code(400).send({ error: 'invalid_region' });
    }
    return json(reply).send({ region: getPhoneRegion(opts.db) });
  });

  done();
};

/** Dashboard settings JSON API: client tokens, default phone region and system status. */
export const settingsRoutes = routes;
