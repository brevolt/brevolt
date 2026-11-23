import type { FastifyInstance, FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { HubDatabase } from '../db/index.js';
import { FailureLimiter, type FailureLimiterOptions } from './rate-limit.js';
import { resolveSession } from './admin.js';
import { CSRF_HEADER, SESSION_COOKIE, parseCookies } from './dashboard.js';
import {
  constantTimeEqual,
  verifyToken,
  type AuthenticatedClient,
  type TokenScope,
} from './tokens.js';

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

/**
 * `/v1` routes the dashboard session may also reach. Client tokens keep their own scopes:
 * undo and export stay closed to every token.
 */
const DASHBOARD_ROUTES: readonly string[] = [
  '/v1/contacts',
  '/v1/changes',
  '/v1/export',
  '/v1/conflicts',
  '/v1/proposals',
];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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

/** Cross-site requests carry an Origin that differs from the host being served. */
function originAllowed(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
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
    if (!token) {
      const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
      const session = sessionId ? resolveSession(opts.db, sessionId, nowDate) : null;
      if (session) {
        if (!DASHBOARD_ROUTES.some((p) => matchesPrefix(path, p))) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (!SAFE_METHODS.has(request.method)) {
          const sent = request.headers[CSRF_HEADER];
          if (typeof sent !== 'string' || !constantTimeEqual(sent, session.csrfToken)) {
            return reply.code(403).send({ error: 'invalid_csrf' });
          }
          if (!originAllowed(request)) return reply.code(403).send({ error: 'forbidden' });
        }
        request.adminSession = session;
        return;
      }
    }
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
