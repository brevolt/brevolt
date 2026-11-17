import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { HubDatabase } from '../db/index.js';
import {
  SESSION_ABSOLUTE_MS,
  createSession,
  destroySession,
  dummyPasswordHash,
  getAdminPasswordHash,
  resolveSession,
  verifyPassword,
  type ActiveSession,
} from './admin.js';
import { constantTimeEqual } from './tokens.js';
import { FailureLimiter, type FailureLimiterOptions } from './rate-limit.js';

export const SESSION_COOKIE = '__Host-brevolt_session';
/** Pre-login CSRF cookie (double submit) for the login form. */
export const LOGIN_CSRF_COOKIE = '__Host-brevolt_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_FIELD = '_csrf';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set on dashboard routes that passed session authentication. */
    adminSession?: ActiveSession;
  }
}

export interface DashboardAuthOptions {
  db: HubDatabase;
  /** Failed-login limit per address. Defaults to 5 failures per 5 minutes. */
  rateLimit?: FailureLimiterOptions;
  now?: () => Date;
  /** Serve the built-in placeholder home at `/`. Turn off when the SPA is served instead. */
  serveHome?: boolean;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function pathOf(request: FastifyRequest): string {
  const url = request.raw.url ?? '';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Paths that do not need a dashboard session. Everything else is denied by default. */
function isPublic(path: string): boolean {
  return path === '/login' || path === '/healthz' || matchesPrefix(path, '/v1');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    if (name && !(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; Max-Age=${String(maxAgeSeconds)}; HttpOnly; Secure; SameSite=Strict`;
}

function html(reply: FastifyReply, body: string, code = 200): FastifyReply {
  return reply
    .code(code)
    .header('Content-Type', 'text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('X-Frame-Options', 'DENY')
    .header('X-Content-Type-Options', 'nosniff')
    .header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    )
    .send(body);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

function loginPage(csrf: string, error?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Brevolt · Sign in</title></head>
<body><main><h1>Brevolt</h1>${error ? `<p role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/login">
<input type="hidden" name="${CSRF_FIELD}" value="${esc(csrf)}">
<label>Password <input type="password" name="password" autocomplete="current-password" required autofocus></label>
<button type="submit">Sign in</button></form></main></body></html>`;
}

function homePage(csrf: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Brevolt</title></head>
<body><main><h1>Brevolt dashboard</h1>
<form method="post" action="/logout"><input type="hidden" name="${CSRF_FIELD}" value="${esc(csrf)}">
<button type="submit">Sign out</button></form></main></body></html>`;
}

function bodyField(request: FastifyRequest, name: string): string | undefined {
  const body = request.body;
  if (body && typeof body === 'object') {
    const v = (body as Record<string, unknown>)[name];
    if (typeof v === 'string') return v;
  }
  return undefined;
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

const dashboardAuth: FastifyPluginCallback<DashboardAuthOptions> = (
  app: FastifyInstance,
  opts,
  done,
) => {
  const limiter = new FailureLimiter(opts.rateLimit ?? { max: 5, windowMs: 5 * 60_000 });
  const now = opts.now ?? (() => new Date());

  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: 16 * 1024 },
      (_req, body, next) => {
        next(null, Object.fromEntries(new URLSearchParams(body as string)));
      },
    );
  }

  const sessionOf = (request: FastifyRequest): { id: string; session: ActiveSession } | null => {
    const id = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!id) return null;
    const session = resolveSession(opts.db, id, now());
    return session ? { id, session } : null;
  };

  app.addHook('onRequest', async (request, reply) => {
    const path = pathOf(request);
    if (matchesPrefix(path, '/v1')) return; // Bearer-token auth, not sessions.
    if (!SAFE_METHODS.has(request.method) && !originAllowed(request)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (isPublic(path)) return;

    const found = sessionOf(request);
    if (!found) {
      if (SAFE_METHODS.has(request.method)) {
        return reply.header('Cache-Control', 'no-store').redirect('/login', 302);
      }
      return reply.code(401).send({ error: 'unauthorized' });
    }
    request.adminSession = found.session;
  });

  // CSRF for authenticated state-changing requests; runs after the body is parsed.
  app.addHook('preHandler', async (request, reply) => {
    if (!request.adminSession || SAFE_METHODS.has(request.method)) return;
    const sent = request.headers[CSRF_HEADER] ?? bodyField(request, CSRF_FIELD);
    if (typeof sent !== 'string' || !constantTimeEqual(sent, request.adminSession.csrfToken)) {
      return reply.code(403).send({ error: 'invalid_csrf' });
    }
  });

  app.get('/login', (request, reply) => {
    if (sessionOf(request)) return reply.redirect('/', 302);
    const csrf = randomBytes(32).toString('base64url');
    reply.header('Set-Cookie', cookie(LOGIN_CSRF_COOKIE, csrf, 600));
    return html(reply, loginPage(csrf));
  });

  app.post('/login', async (request, reply) => {
    const t = now();
    const key = request.ip;
    const retry = limiter.retryAfterSeconds(key, t.getTime());
    if (retry > 0) {
      return reply
        .code(429)
        .header('Retry-After', String(retry))
        .send({ error: 'too_many_requests' });
    }

    const csrfCookie = parseCookies(request.headers.cookie)[LOGIN_CSRF_COOKIE];
    const csrfSent = request.headers[CSRF_HEADER] ?? bodyField(request, CSRF_FIELD);
    if (!csrfCookie || typeof csrfSent !== 'string' || !constantTimeEqual(csrfSent, csrfCookie)) {
      return reply.code(403).send({ error: 'invalid_csrf' });
    }

    const password = bodyField(request, 'password') ?? '';
    const stored = getAdminPasswordHash(opts.db);
    const valid = await verifyPassword(stored ?? (await dummyPasswordHash()), password);
    if (!stored || !valid) {
      limiter.recordFailure(key, t.getTime());
      const next = randomBytes(32).toString('base64url');
      reply.header('Set-Cookie', cookie(LOGIN_CSRF_COOKIE, next, 600));
      return html(reply, loginPage(next, 'Incorrect password.'), 401);
    }

    const session = createSession(opts.db, t);
    return reply
      .header('Set-Cookie', [
        cookie(SESSION_COOKIE, session.id, Math.floor(SESSION_ABSOLUTE_MS / 1000)),
        cookie(LOGIN_CSRF_COOKIE, '', 0),
      ])
      .header('Cache-Control', 'no-store')
      .redirect('/', 303);
  });

  app.post('/logout', (request, reply) => {
    const id = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (id) destroySession(opts.db, id);
    return reply
      .header('Set-Cookie', cookie(SESSION_COOKIE, '', 0))
      .header('Cache-Control', 'no-store')
      .redirect('/login', 303);
  });

  if (opts.serveHome !== false) {
    app.get('/', (request, reply) => html(reply, homePage(request.adminSession?.csrfToken ?? '')));
  }

  done();
};

/** Session login, logout and CSRF protection for every non-API route (BRV-025). */
export const dashboardAuthPlugin = fp(dashboardAuth, { name: 'brevolt-dashboard-auth' });
