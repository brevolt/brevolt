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
  | { ok: false; status: number; currentVersion?: number; fields?: string[] };

const csrf = (): string =>
  document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

export const newOperationId = (): string => crypto.randomUUID();

async function call<T>(
  method: string,
  url: string,
  opts: { body?: unknown; version?: number; operationId?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'x-csrf-token': csrf() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.version !== undefined) headers['if-match'] = String(opts.version);
  if (opts.operationId) headers['x-operation-id'] = opts.operationId;
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (res.status === 401) {
    window.location.assign('/login');
    return { ok: false, status: 401 };
  }
  const text = await res.text();
  const json = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  if (res.ok) return { ok: true, value: json as T };
  return {
    ok: false,
    status: res.status,
    ...(typeof json.currentVersion === 'number' ? { currentVersion: json.currentVersion } : {}),
    ...(Array.isArray(json.fields) ? { fields: json.fields as string[] } : {}),
  };
}

export const api = {
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
