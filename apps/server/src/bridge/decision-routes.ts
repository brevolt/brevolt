import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { HubDatabase } from '../db/index.js';
import type { WriteContext } from '../contacts/service.js';
import { Decisions, resolveConflictSchema, type DecisionResult } from './decisions.js';

export interface DecisionRoutesOptions {
  db: HubDatabase;
  now?: () => Date;
}

const idParams = z.object({ id: z.uuid() });
const conflictQuery = z.object({ status: z.enum(['pending', 'resolved', 'all']).optional() });
const proposalQuery = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'withdrawn', 'all']).optional(),
});

const routes: FastifyPluginCallback<DecisionRoutesOptions> = (app: FastifyInstance, opts, done) => {
  const decisions = new Decisions(opts.db);
  const now = opts.now ?? (() => new Date());

  const invalid = (reply: FastifyReply, error: z.ZodError) =>
    reply.code(400).send({ error: 'validation', issues: error.issues });
  const ctxOf = (request: FastifyRequest): WriteContext => {
    const header = request.headers['x-operation-id'];
    const given = typeof header === 'string' && /^[\w.:-]{1,128}$/.test(header) ? header : null;
    return { actor: 'dashboard', operationId: given ?? randomUUID(), now: now() };
  };
  const send = <T>(reply: FastifyReply, result: DecisionResult<T>) => {
    if (result.ok) return result.value;
    if (result.reason === 'not_found') return reply.code(404).send({ error: 'not_found' });
    if (result.reason === 'invalid_value') {
      return reply.code(400).send({ error: 'invalid_value', message: result.message });
    }
    return reply
      .code(409)
      .send({ error: result.reason, ...('message' in result ? { message: result.message } : {}) });
  };

  app.get('/v1/conflicts', (request, reply) => {
    const q = conflictQuery.safeParse(request.query);
    if (!q.success) return invalid(reply, q.error);
    return { conflicts: decisions.listConflicts(q.data.status) };
  });

  app.post('/v1/conflicts/:id/resolve', (request, reply) => {
    const p = idParams.safeParse(request.params);
    if (!p.success) return invalid(reply, p.error);
    const body = resolveConflictSchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    return send(reply, decisions.resolveConflict(p.data.id, body.data, ctxOf(request)));
  });

  app.get('/v1/proposals', (request, reply) => {
    const q = proposalQuery.safeParse(request.query);
    if (!q.success) return invalid(reply, q.error);
    return { proposals: decisions.listProposals(q.data.status) };
  });

  app.post('/v1/proposals/:id/accept', (request, reply) => {
    const p = idParams.safeParse(request.params);
    if (!p.success) return invalid(reply, p.error);
    return send(reply, decisions.acceptProposal(p.data.id, ctxOf(request)));
  });

  app.post('/v1/proposals/:id/reject', (request, reply) => {
    const p = idParams.safeParse(request.params);
    if (!p.success) return invalid(reply, p.error);
    return send(reply, decisions.rejectProposal(p.data.id, ctxOf(request)));
  });

  done();
};

/** Dashboard-only: clients never decide (R-SYNC-4). Register after `tokenAuthPlugin`. */
export const decisionRoutes = routes;
