import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from 'fastify';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { CSRF_FIELD } from '../auth/dashboard.js';
import { SCOPE_BY_KIND, createClientToken, revokeClientToken } from '../auth/tokens.js';
import { client } from '../db/schema.js';
import type { HubDatabase } from '../db/index.js';
import type { AdapterStatus } from '../app.js';
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
const idParams = z.object({ id: z.uuid() });

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

interface Notice {
  kind: 'error' | 'info';
  text: string;
}

interface PageData {
  csrf: string;
  nonce: string;
  newToken?: { name: string; value: string };
  notice?: Notice;
}

function renderPage(db: HubDatabase, adapters: Record<string, AdapterStatus>, d: PageData): string {
  const rows = db.select().from(client).orderBy(desc(client.createdAt)).all();
  const csrf = `<input type="hidden" name="${CSRF_FIELD}" value="${esc(d.csrf)}">`;
  const tokenRows = rows
    .map((r) => {
      const state = r.revokedAt ? 'revoked' : 'active';
      const action = r.revokedAt
        ? ''
        : `<form method="post" action="/settings/tokens/${esc(r.id)}/revoke">${csrf}<button type="submit">Revoke</button></form>`;
      return `<tr><td>${esc(r.name)}</td><td>${esc(SCOPE_BY_KIND[r.kind])}</td><td>${esc(r.lastSeen ?? 'never')}</td><td>${state}</td><td>${action}</td></tr>`;
    })
    .join('');
  const systems = Object.entries(adapters)
    .map(([name, status]) => `<li>${esc(name)}: ${esc(status)}</li>`)
    .join('');
  const created = d.newToken
    ? `<section id="new-token" role="status"><h2>Token created: ${esc(d.newToken.name)}</h2>
<p>Copy it now. It will not be shown again.</p>
<input id="token-value" type="text" readonly value="${esc(d.newToken.value)}" size="60">
<button type="button" id="copy-token">Copy</button> <span id="copy-result" aria-live="polite"></span>
<script nonce="${d.nonce}">
document.getElementById('copy-token').addEventListener('click', function () {
  var input = document.getElementById('token-value');
  var done = function (ok) { document.getElementById('copy-result').textContent = ok ? 'Copied' : 'Copy failed'; };
  if (navigator.clipboard) { navigator.clipboard.writeText(input.value).then(function () { done(true); }, function () { done(false); }); }
  else { input.select(); done(document.execCommand('copy')); }
});
</script></section>`
    : '';
  const notice = d.notice
    ? `<p role="${d.notice.kind === 'error' ? 'alert' : 'status'}">${esc(d.notice.text)}</p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Brevolt · Settings</title></head>
<body><main><h1>Settings</h1><p><a href="/">Back</a></p>${notice}${created}
<section><h2>Client tokens</h2>
<table><thead><tr><th>Name</th><th>Scope</th><th>Last seen</th><th>Status</th><th></th></tr></thead><tbody>${tokenRows}</tbody></table>
<h3>Create token</h3>
<form method="post" action="/settings/tokens">${csrf}
<label>Name <input name="name" maxlength="100" required></label>
<label>Client <select name="kind"><option value="bridge-macos">macOS bridge</option><option value="obsidian">Obsidian plugin</option></select></label>
<button type="submit">Create token</button></form></section>
<section><h2>Default phone region</h2>
<form method="post" action="/settings/region">${csrf}
<label>Region (ISO 3166-1, e.g. ES) <input name="region" value="${esc(getPhoneRegion(db))}" maxlength="2" pattern="[A-Za-z]{2}" required></label>
<button type="submit">Save</button></form></section>
<section><h2>Connected systems</h2>${systems ? `<ul>${systems}</ul>` : '<p>No systems connected yet.</p>'}</section>
</main></body></html>`;
}

const routes: FastifyPluginCallback<SettingsRoutesOptions> = (app: FastifyInstance, opts, done) => {
  const now = opts.now ?? (() => new Date());

  const send = (reply: FastifyReply, csrf: string, extra: Partial<PageData> = {}, code = 200) => {
    const nonce = randomBytes(16).toString('base64');
    const page = renderPage(opts.db, opts.adapters?.() ?? {}, { csrf, nonce, ...extra });
    return reply
      .code(code)
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('X-Frame-Options', 'DENY')
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Security-Policy',
        `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'`,
      )
      .send(page);
  };

  app.get('/settings', (request, reply) => send(reply, request.adminSession?.csrfToken ?? ''));

  app.post('/settings/tokens', (request, reply) => {
    const csrf = request.adminSession?.csrfToken ?? '';
    const body = createBody.safeParse(request.body);
    if (!body.success) {
      return send(
        reply,
        csrf,
        { notice: { kind: 'error', text: 'Enter a name and a client.' } },
        400,
      );
    }
    const created = createClientToken(opts.db, body.data, now());
    return send(reply, csrf, { newToken: { name: created.name, value: created.token } });
  });

  app.post('/settings/tokens/:id/revoke', (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    revokeClientToken(opts.db, params.data.id, now());
    return reply.header('Cache-Control', 'no-store').redirect('/settings', 303);
  });

  app.post('/settings/region', (request, reply) => {
    const csrf = request.adminSession?.csrfToken ?? '';
    const body = regionBody.safeParse(request.body);
    if (!body.success || !setPhoneRegion(opts.db, body.data.region)) {
      return send(
        reply,
        csrf,
        { notice: { kind: 'error', text: 'Enter a valid two-letter region code.' } },
        400,
      );
    }
    return reply.header('Cache-Control', 'no-store').redirect('/settings', 303);
  });

  done();
};

/** Dashboard settings: client tokens, default phone region and system status (BRV-027). */
export const settingsRoutes = routes;
