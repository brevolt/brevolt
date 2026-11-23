import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { bridgeAckRequestSchema, bridgeChangesRequestSchema } from '@brevolt/contracts';
import type { HubDatabase } from '../db/index.js';
import { BridgeSync } from './sync.js';

export interface BridgeRoutesOptions {
  db: HubDatabase;
  now?: () => Date;
}

const pendingQuery = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,15}$/)
    .optional(),
});

const routes: FastifyPluginCallback<BridgeRoutesOptions> = (app: FastifyInstance, opts, done) => {
  const sync = new BridgeSync(opts.db, opts.now ?? (() => new Date()));

  app.post('/v1/bridge/changes', (request, reply) => {
    const clientId = request.client?.id;
    if (!clientId) return reply.code(401).send({ error: 'unauthorized' });
    const body = bridgeChangesRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'validation', issues: body.error.issues });
    return { results: sync.receiveChanges(clientId, body.data.changes) };
  });

  app.get('/v1/bridge/pending', (request, reply) => {
    const clientId = request.client?.id;
    if (!clientId) return reply.code(401).send({ error: 'unauthorized' });
    const q = pendingQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues });
    const page = sync.pending(clientId, Number(q.data.cursor ?? 0));
    return reply.header('Cache-Control', 'no-store').send({
      changes: page.changes,
      next_cursor: page.next,
    });
  });

  app.post('/v1/bridge/ack', (request, reply) => {
    const clientId = request.client?.id;
    if (!clientId) return reply.code(401).send({ error: 'unauthorized' });
    const body = bridgeAckRequestSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'validation', issues: body.error.issues });
    return { results: sync.ack(clientId, body.data.acks) };
  });

  done();
};

/** `/v1/bridge/*`. Register after `tokenAuthPlugin`, which sets `request.client`. */
export const bridgeRoutes = routes;
