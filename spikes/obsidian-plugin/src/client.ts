import { requestUrl } from "obsidian";

export interface SpikeClientConfig {
  baseUrl: string;
  token: string;
}

/** GET a JSON resource using Obsidian's `requestUrl` (not fetch: no CORS on desktop, works on mobile). */
export async function getJson<T>(cfg: SpikeClientConfig, path: string): Promise<T> {
  const res = await requestUrl({
    url: new URL(path, cfg.baseUrl).toString(),
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.token}` },
    throw: true,
  });
  return res.json as T;
}

export const ping = (cfg: SpikeClientConfig) => getJson<{ ok: boolean }>(cfg, "/v1/ping");
export const fetchPatch = (cfg: SpikeClientConfig) => getJson<Record<string, unknown>>(cfg, "/v1/contacts/spike");
