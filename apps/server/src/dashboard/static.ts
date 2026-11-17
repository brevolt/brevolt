import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from 'fastify';

export interface DashboardStaticOptions {
  /** Directory holding the built dashboard (`index.html` plus `assets/`). */
  dir: string;
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

export const DASHBOARD_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

function baseHeaders(reply: FastifyReply): FastifyReply {
  return reply.header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY');
}

/**
 * Serves the built single-page dashboard. Requests reaching these routes already passed
 * session authentication; every unknown path gets `index.html` so client-side routes work.
 */
const staticRoutes: FastifyPluginCallback<DashboardStaticOptions> = (
  app: FastifyInstance,
  opts,
  done,
) => {
  const root = normalize(opts.dir);
  let indexHtml: string | undefined;
  const index = (): string => (indexHtml ??= readFileSync(join(root, 'index.html'), 'utf8'));

  app.get('/assets/*', (request, reply) => {
    const rel = normalize((request.params as { '*': string })['*']);
    const file = join(root, 'assets', rel);
    if (rel.startsWith('..') || !file.startsWith(join(root, 'assets') + sep)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      return baseHeaders(reply)
        .header('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .send(readFileSync(file));
    } catch {
      return reply.code(404).send({ error: 'not_found' });
    }
  });

  const page = (
    request: { adminSession?: { csrfToken: string } | undefined },
    reply: FastifyReply,
  ) =>
    baseHeaders(reply)
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('Content-Security-Policy', DASHBOARD_CSP)
      .send(index().replace('__CSRF__', esc(request.adminSession?.csrfToken ?? '')));

  app.get('/', page);
  app.get('/*', page);

  done();
};

export const dashboardStaticRoutes = staticRoutes;
