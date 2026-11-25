export interface Field {
  id?: string;
  kind: 'phone' | 'email' | 'address' | 'url';
  label: string;
  value: string;
}

export interface Contact {
  id: string;
  version: number;
  prefix: string | null;
  givenName: string | null;
  middleName: string | null;
  familyNames: string | null;
  suffix: string | null;
  nickname: string | null;
  company: string | null;
  jobTitle: string | null;
  birthday: string | null;
  noteMd: string;
  updatedAt: string;
  deletedAt: string | null;
  fields: Field[];
  tags: string[];
  custom: Record<string, string>;
}

export interface HistoryEntry {
  operationId: string;
  ts: string;
  actor: string;
  fields: string[];
}

export type Draft = Omit<Contact, 'id' | 'version' | 'updatedAt' | 'deletedAt'>;

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error?: string; currentVersion?: number; fields?: string[] };

let sessionCsrf: string | undefined;
const csrf = (): string =>
  sessionCsrf ?? document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
export const setCsrf = (token: string): void => {
  sessionCsrf = token;
};

export const newOperationId = (): string => crypto.randomUUID();

async function call<T>(
  method: string,
  url: string,
  opts: {
    body?: unknown;
    version?: number;
    operationId?: string;
    csrf?: string;
    /** Keep a 401 as a result (login attempts) instead of leaving for the login page. */
    keep401?: boolean;
  } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'x-csrf-token': opts.csrf ?? csrf() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.version !== undefined) headers['if-match'] = String(opts.version);
  if (opts.operationId) headers['x-operation-id'] = opts.operationId;
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (res.status === 401 && !opts.keep401) {
    window.location.assign('/login');
    return { ok: false, status: 401 };
  }
  const text = await res.text();
  const json = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  if (res.ok) return { ok: true, value: json as T };
  return {
    ok: false,
    status: res.status,
    ...(typeof json.error === 'string' ? { error: json.error } : {}),
    ...(typeof json.currentVersion === 'number' ? { currentVersion: json.currentVersion } : {}),
    ...(Array.isArray(json.fields) ? { fields: json.fields as string[] } : {}),
  };
}

export interface TokenRow {
  id: string;
  name: string;
  kind: 'bridge-macos' | 'obsidian';
  scope: string;
  createdAt: string;
  lastSeen: string | null;
  revokedAt: string | null;
}

export interface SettingsData {
  tokens: TokenRow[];
  region: string;
  systems: Record<string, string>;
}

export interface CreatedToken {
  id: string;
  name: string;
  kind: TokenRow['kind'];
  scope: string;
  token: string;
}

export interface ContactRef {
  id: string;
  givenName: string | null;
  familyNames: string | null;
  company: string | null;
}

export type System = 'icloud' | 'google' | 'obsidian';

export interface ConflictRow {
  id: string;
  contact: ContactRef;
  /** A scalar field name, or `fields:<kind>:<normalized>` for a list entry. */
  field: string;
  system: System;
  base: unknown;
  hubValue: unknown;
  externalValue: unknown;
  status: 'pending' | 'resolved';
}

export interface SnapshotView {
  givenName: string | null;
  familyNames: string | null;
  company: string | null;
  fields: { kind: string; label: string; value: string }[];
  [key: string]: unknown;
}

export interface ProposalRow {
  id: string;
  type: 'merge' | 'deleted-upstream';
  system: System;
  contact: ContactRef;
  hub: SnapshotView | null;
  external: SnapshotView | null;
  reason: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
}

export type Resolution =
  { resolution: 'hub' } | { resolution: 'external' } | { resolution: 'manual'; value: unknown };

export const api = {
  conflicts: () => call<{ conflicts: ConflictRow[] }>('GET', '/v1/conflicts?status=pending'),
  proposals: () => call<{ proposals: ProposalRow[] }>('GET', '/v1/proposals?status=pending'),
  resolveConflict: (id: string, body: Resolution) =>
    call<unknown>('POST', `/v1/conflicts/${encodeURIComponent(id)}/resolve`, { body }),
  acceptProposal: (id: string) =>
    call<unknown>('POST', `/v1/proposals/${encodeURIComponent(id)}/accept`, { body: {} }),
  rejectProposal: (id: string) =>
    call<unknown>('POST', `/v1/proposals/${encodeURIComponent(id)}/reject`, { body: {} }),
  loginCsrf: () => call<{ csrfToken: string }>('GET', '/login/csrf'),
  login: (password: string, loginCsrf: string) =>
    call<{ csrfToken: string }>('POST', '/login', {
      body: { password },
      csrf: loginCsrf,
      keep401: true,
    }),
  settings: () => call<SettingsData>('GET', '/api/settings'),
  createToken: (body: { name: string; kind: TokenRow['kind'] }) =>
    call<CreatedToken>('POST', '/api/settings/tokens', { body }),
  revokeToken: (id: string) =>
    call<{ ok: true }>('POST', `/api/settings/tokens/${encodeURIComponent(id)}/revoke`, {
      body: {},
    }),
  saveRegion: (region: string) =>
    call<{ region: string }>('PUT', '/api/settings/region', { body: { region } }),
  changePassword: (body: {
    currentPassword: string;
    newPassword: string;
    repeatPassword: string;
  }) => call<{ csrfToken: string }>('POST', '/api/settings/password', { body }),
  list: (q: string, offset: number, limit: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({
      order: 'name',
      limit: String(limit),
      offset: String(offset),
    });
    if (q.trim()) params.set('q', q.trim());
    return fetch(`/v1/contacts?${params.toString()}`, {
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    }).then(async (r) => {
      if (r.status === 401) window.location.assign('/login');
      return r.ok ? ((await r.json()) as { contacts: Contact[]; total: number }) : null;
    });
  },
  get: (id: string) => call<Contact>('GET', `/v1/contacts/${id}`),
  create: (body: Partial<Draft>, operationId: string) =>
    call<Contact>('POST', '/v1/contacts', { body, operationId }),
  update: (id: string, body: Partial<Draft>, version: number, operationId: string) =>
    call<Contact>('PATCH', `/v1/contacts/${id}`, { body, version, operationId }),
  remove: (id: string, version: number, operationId: string) =>
    call<Record<string, never>>('DELETE', `/v1/contacts/${id}`, { version, operationId }),
  history: (id: string) => call<{ history: HistoryEntry[] }>('GET', `/v1/contacts/${id}/history`),
  undo: (operationId: string) =>
    call<{ contact: Contact }>('POST', `/v1/changes/${encodeURIComponent(operationId)}/undo`),
  csrf,
};
