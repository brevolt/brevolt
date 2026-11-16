// Test-only stand-in for the runtime `obsidian` module (the npm package ships types only).
export async function requestUrl(p: { url: string; method?: string; headers?: Record<string, string>; throw?: boolean }) {
  const r = await fetch(p.url, { method: p.method, headers: p.headers });
  if (!r.ok && p.throw !== false) throw new Error(`Request failed, status ${r.status}`);
  return { status: r.status, json: await r.json() };
}
export class Notice {}
export class Plugin {}
export class TFile {}
