import type { FastifyInstance, FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { HubDatabase } from '../db/index.js';
import { FailureLimiter, type FailureLimiterOptions } from './rate-limit.js';
import { verifyToken, type AuthenticatedClient, type TokenScope } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set on `/v1/*` requests that passed token authentication. */
    client?: AuthenticatedClient;
  }
}

/** Route prefixes each scope may reach (R-SEC-7). Everything else under /v1 is 403. */
const SCOPE_ROUTES: Record<TokenScope, readonly string[]> = {
  bridge: ['/v1/bridge'],
  obsidian: ['/v1/contacts'],
};

export interface TokenAuthOptions {
  db: HubDatabase;
  /** Failed-attempt limit per address. Defaults to 10 failures per minute. */
  rateLimit?: FailureLimiterOptions;
  now?: () => Date;
}

function pathOf(request: FastifyRequest): string {
  const url = request.raw.url ?? '';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isInScope(scope: TokenScope, path: string): boolean {
  return SCOPE_ROUTES[scope].some((p) => matchesPrefix(path, p));
}

function bearer(header: string | undefined): string | null {
  const m = /^Bearer ([^\s]+)$/i.exec(header ?? '');
  return m?.[1] ?? null;
}

const tokenAuth: FastifyPluginCallback<TokenAuthOptions> = (app: FastifyInstance, opts, done) => {
  const limiter = new FailureLimiter(opts.rateLimit ?? { max: 10, windowMs: 60_000 });
  const now = opts.now ?? (() => new Date());

  app.addHook('onRequest', async (request, reply) => {
    const path = pathOf(request);
    if (!matchesPrefix(path, '/v1')) return;

    const key = request.ip;
    const nowDate = now();
    const retry = limiter.retryAfterSeconds(key, nowDate.getTime());
    if (retry > 0) {
      return reply
        .code(429)
        .header('Retry-After', String(retry))
        .send({ error: 'too_many_requests' });
    }

    const token = bearer(request.headers.authorization);
    const result = token ? verifyToken(opts.db, token, nowDate) : null;
    if (!result?.ok) {
      limiter.recordFailure(key, nowDate.getTime());
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'unauthorized' });
    }
    if (!isInScope(result.client.scope, path)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    request.client = result.client;
  });
  done();
};

/** Bearer-token auth for `/v1/*`: scope enforcement and rate limiting of failures. */
export const tokenAuthPlugin = fp(tokenAuth, { name: 'brevolt-token-auth' });
