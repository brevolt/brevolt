import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import type { HubDatabase } from '../db/index.js';
import { ContactService } from '../contacts/service.js';
import { buildExport } from '../export/json.js';
import { contactsToVCard } from '../export/vcard.js';

export interface ChangeRoutesOptions {
  db: HubDatabase;
  now?: () => Date;
}

const undoParams = z.object({ operationId: z.string().regex(/^[\w.:-]{1,128}$/) });
const exportQuery = z.object({ format: z.enum(['vcf', 'json']) });

const routes: FastifyPluginCallback<ChangeRoutesOptions> = (app: FastifyInstance, opts, done) => {
  const service = new ContactService(opts.db);
  const now = opts.now ?? (() => new Date());

  app.post('/v1/changes/:operationId/undo', (request, reply) => {
    const p = undoParams.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'validation', issues: p.error.issues });
    const header = request.headers['x-operation-id'];
    const given = typeof header === 'string' && /^[\w.:-]{1,128}$/.test(header) ? header : null;
    const result = service.undo(p.data.operationId, {
      actor: `client:${request.client?.id ?? 'unknown'}`,
      operationId: given ?? randomUUID(),
      now: now(),
    });
    if (result.ok) {
      return reply
        .header('ETag', `"${String(result.value.version)}"`)
        .send({ undone: p.data.operationId, contact: result.value });
    }
    if (result.reason === 'not_found') return reply.code(404).send({ error: 'not_found' });
    return reply.code(409).send({ error: 'conflict', fields: result.fields });
  });

  app.get('/v1/export', (request, reply) => {
    const q = exportQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'validation', issues: q.error.issues });
    const contacts = service.listAll();
    reply.header('Cache-Control', 'no-store');
    if (q.data.format === 'vcf') {
      return reply
        .header('Content-Type', 'text/vcard; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="brevolt-contacts.vcf"')
        .send(contactsToVCard(contacts));
    }
    return reply
      .header('Content-Disposition', 'attachment; filename="brevolt-contacts.json"')
      .send(buildExport(contacts, now()));
  });

  done();
};

/** `/v1/changes/:operationId/undo` and `/v1/export`. Register after `tokenAuthPlugin`. */
export const changeRoutes = routes;
