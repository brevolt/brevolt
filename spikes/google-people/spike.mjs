#!/usr/bin/env node
// BRV-002 spike: People API sync cycle. Test account ONLY. Secrets via env / git-ignored files.
// Usage: node spike.mjs <auth|list|sync|update|stale-etag|expired|quota>  [args]
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (load with `node --env-file=.env spike.mjs ...`)
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';

const TOKENS = new URL('./.tokens.json', import.meta.url);
const STATE = new URL("./.sync-state.json", import.meta.url); // git-ignored
const FIXTURES = new URL('./fixtures/', import.meta.url);
const SCOPE = 'https://www.googleapis.com/auth/contacts';
const PORT = 8765;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const FIELDS = 'names,emailAddresses,phoneNumbers,metadata';
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; };

// ---- anonymization for fixtures
const anon = (obj) => {
  let n = 0;
  const s = JSON.stringify(obj)
    .replace(/people\/c\d+/g, () => `people/c${1000 + n++}`)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'user@example.com')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '+34 600 000 000')
    .replace(/"(etag|syncToken|nextPageToken|nextSyncToken)":"[^"]+"/g, '"$1":"REDACTED"')
    .replace(/"(displayName|givenName|familyName|unstructuredName|displayNameLastFirst)":"[^"]*"/g, '"$1":"Test Person"');
  return JSON.parse(s);
};
const save = async (name, data) => writeFile(new URL(name, FIXTURES), JSON.stringify(anon(data), null, 2) + '\n');

// ---- OAuth (authorization code + PKCE, loopback redirect)
async function auth() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: need('GOOGLE_CLIENT_ID'), redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  console.log('Open in browser:\n' + url);
  const code = await new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') { res.end(); return; }
      res.end('OK, you can close this tab.');
      srv.close();
      u.searchParams.get('state') === state ? resolve(u.searchParams.get('code')) : reject(new Error('state mismatch'));
    }).listen(PORT, '127.0.0.1');
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ code, client_id: need('GOOGLE_CLIENT_ID'), client_secret: need('GOOGLE_CLIENT_SECRET'),
      redirect_uri: REDIRECT, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const t = await r.json();
  if (!t.refresh_token) throw new Error('No refresh_token: ' + (t.error ?? 'revoke app access and retry'));
  await writeFile(TOKENS, JSON.stringify({ refresh_token: t.refresh_token }), { mode: 0o600 });
  console.log('refresh_token stored in .tokens.json (git-ignored). Scope:', t.scope);
}

async function accessToken() {
  const { refresh_token } = JSON.parse(await readFile(TOKENS, 'utf8'));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ refresh_token, client_id: need('GOOGLE_CLIENT_ID'), client_secret: need('GOOGLE_CLIENT_SECRET'), grant_type: 'refresh_token' }),
  });
  const t = await r.json();
  if (!t.access_token) throw new Error('refresh failed: ' + JSON.stringify(t)); // e.g. invalid_grant
  return t.access_token;
}

async function api(method, path, { params, body } = {}) {
  const url = new URL('https://people.googleapis.com/v1/' + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, retryAfter: r.headers.get('retry-after'), json };
}

async function listAll(extra) {
  const pages = []; let pageToken;
  do {
    const r = await api('GET', 'people/me/connections', { params: { personFields: FIELDS, pageSize: '1000', ...extra, ...(pageToken && { pageToken }) } });
    if (r.status !== 200) return { error: r };
    pages.push(r.json); pageToken = r.json.nextPageToken;
  } while (pageToken);
  return { pages, nextSyncToken: pages.at(-1).nextSyncToken };
}

const cmds = {
  auth,
  async list() { // initial full listing + syncToken
    const r = await listAll({ requestSyncToken: 'true' });
    if (r.error) return console.log(r.error);
    await writeFile(STATE, JSON.stringify({ syncToken: r.nextSyncToken }), { mode: 0o600 });
    await save('connections-initial.json', r.pages[0]);
    console.log('pages:', r.pages.length, 'people:', r.pages.reduce((n, p) => n + (p.connections?.length ?? 0), 0));
  },
  async sync() { // incremental; deleted contacts come with metadata.deleted=true
    const { syncToken } = JSON.parse(await readFile(STATE, 'utf8'));
    const r = await listAll({ requestSyncToken: 'true', syncToken });
    if (r.error) return console.log('ERROR', r.error.status, JSON.stringify(r.error.json));
    await writeFile(STATE, JSON.stringify({ syncToken: r.nextSyncToken }), { mode: 0o600 });
    await save('connections-incremental.json', r.pages[0]);
    console.log(JSON.stringify(anon(r.pages.flatMap((p) => p.connections ?? []).map((c) => ({ id: c.resourceName, deleted: c.metadata?.deleted ?? false }))), null, 1));
  },
  async update(resourceName, familyName) { // update with fresh etag
    const g = await api('GET', resourceName, { params: { personFields: FIELDS } });
    const body = { ...g.json, names: [{ ...g.json.names?.[0], familyName }] };
    const r = await api('PATCH', `${resourceName}:updateContact`, { params: { updatePersonFields: 'names', personFields: FIELDS }, body });
    console.log(r.status); await save('update-ok.json', r.json);
  },
  async 'stale-etag'(resourceName) { // update twice with the same (now stale) etag
    const g = await api('GET', resourceName, { params: { personFields: FIELDS } });
    const mk = (fam) => ({ ...g.json, names: [{ ...g.json.names?.[0], familyName: fam }] });
    const p = { updatePersonFields: 'names', personFields: FIELDS };
    const a = await api('PATCH', `${resourceName}:updateContact`, { params: p, body: mk('Spike A') });
    const b = await api('PATCH', `${resourceName}:updateContact`, { params: p, body: mk('Spike B') });
    console.log('fresh:', a.status, 'stale:', b.status, JSON.stringify(b.json));
    await save('update-stale-etag-error.json', { status: b.status, ...b.json });
  },
  async expired() { // needs a syncToken > 7 days old, or a garbage token to compare errors
    const token = process.argv[3] ?? 'invalid-token';
    const r = await api('GET', 'people/me/connections', { params: { personFields: 'names', requestSyncToken: 'true', syncToken: token } });
    console.log(r.status, JSON.stringify(r.json)); await save('sync-token-error.json', { status: r.status, ...r.json });
  },
  async quota() { // burst reads until 429; backoff behaviour. Small bounded burst, test account only.
    const t0 = Date.now(); const seen = [];
    for (let i = 0; i < 200; i++) {
      const r = await api('GET', 'people/me/connections', { params: { personFields: 'names', pageSize: '1' } });
      if (r.status !== 200) { seen.push({ i, ms: Date.now() - t0, status: r.status, retryAfter: r.retryAfter, err: r.json.error }); break; }
    }
    console.log(JSON.stringify(seen, null, 1)); if (seen[0]) await save('quota-error.json', seen[0]);
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmds[cmd]) { console.error('Usage: spike.mjs <' + Object.keys(cmds).join('|') + '>'); process.exit(1); }
await cmds[cmd](...args);
