import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { HubDatabase } from '../db/index.js';
import {
  ContactService,
  createContactSchema,
  patchContactSchema,
  type WriteContext,
  type WriteResult,
} from './service.js';

export interface ContactRoutesOptions {
  db: HubDatabase;
  now?: () => Date;
}

/** Accepts `3`, `"3"` or `W/"3"`; anything else is invalid. */
function parseIfMatch(header: string | string[] | undefined): number | null | 'invalid' {
  if (header === undefined) return null;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec((Array.isArray(header) ? header[0] : header)?.trim() ?? '');
  return m ? Number(m[1]) : 'invalid';
}

const etag = (version: number): string => `"${String(version)}"`;

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({
  updatedSince: z.iso.datetime({ offset: true }).optional(),
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  order: z.enum(['updated', 'name']).optional(),
});

const routes: FastifyPluginCallback<ContactRoutesOptions> = (app: FastifyInstance, opts, done) => {
  const service = new ContactService(opts.db);
  const now = opts.now ?? (() => new Date());

  const invalid = (reply: FastifyReply, error: z.ZodError) =>
    reply.code(400).send({ error: 'validation', issues: error.issues });

  const ctxOf = (request: FastifyRequest): WriteContext => {
    const header = request.headers['x-operation-id'];
    const given = typeof header === 'string' && /^[\w.:-]{1,128}$/.test(header) ? header : null;
    return {
      actor: request.adminSession ? 'dashboard' : `client:${request.client?.id ?? 'unknown'}`,
      operationId: given ?? randomUUID(),
      now: now(),
    };
  };

  const send = <T extends { version: number }>(
    reply: FastifyReply,
    result: WriteResult<T>,
    status = 200,
  ) => {
    if (result.ok) {
      return reply.code(status).header('ETag', etag(result.value.version)).send(result.value);
    }
    if (result.reason === 'not_found') return reply.code(404).send({ error: 'not_found' });
    return reply
      .code(412)
      .header('ETag', etag(result.current))
      .send({ error: 'version_mismatch', currentVersion: result.current });
  };

  app.get('/v1/contacts', (request, reply) => {
    const q = listQuery.safeParse(request.query);
    if (!q.success) return invalid(reply, q.error);
    const { contacts, total } = service.listPage(q.data);
    return { contacts, total };
  });

  app.get('/v1/contacts/:id/history', (request, reply) => {
    const p = idParams.safeParse(request.params);
    if (!p.success) return invalid(reply, p.error);
    return { history: service.history(p.data.id) };
  });

  app.get('/v1/contacts/:id', (request, reply) => {
    const p = idParams.safeParse(request.params);
    if (!p.success) return invalid(reply, p.error);
    const found = service.get(p.data.id);
    if (!found) return reply.code(404).send({ error: 'not_found' });
    return reply.header('ETag', etag(found.version)).send(found);
  });

  app.post('/v1/contacts', (request, reply) => {
    const body = createContactSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error);
    const created = service.create(body.data, ctxOf(request));
    return reply
      .code(201)
      .header('ETag', etag(created.version))
      .header('Location', `/v1/contacts/${created.id}`)
      .send(created);
  });

  app.patch('/v1/contacts/:id', (request, reply) => {
    const p = idParams.safeParse(request.params);
    if (!p.success) return invalid(reply, p.error);
    const version = parseIfMatch(request.headers['if-match']);
    if (version === null) {
      return reply
        .code(428)
        .send({ error: 'precondition_required', hint: 'Send If-Match: <version>' });
    }
    if (version === 'invalid') return reply.code(400).send({ error: 'invalid_if_match' });
    const body = patchContactSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error);
    return send(reply, service.update(p.data.id, body.data, version, ctxOf(request)));
  });

  app.delete('/v1/contacts/:id', (request, reply) => {
    const p = idParams.safeParse(request.params);
    if (!p.success) return invalid(reply, p.error);
    // If-Match is optional on delete, but a stale one is still rejected.
    const version = parseIfMatch(request.headers['if-match']);
    if (version === 'invalid') return reply.code(400).send({ error: 'invalid_if_match' });
    const result = service.remove(p.data.id, version, ctxOf(request));
    if (result.ok) return reply.code(204).send();
    return send(reply, result);
  });

  done();
};

/** `/v1/contacts` endpoints. Register after `tokenAuthPlugin` so `request.client` is set. */
export const contactRoutes = routes;
