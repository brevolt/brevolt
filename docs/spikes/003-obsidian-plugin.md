# Spike 003 — Obsidian plugin: network and frontmatter (BRV-003)

Requirements: R-OB-2, R-OB-3, R-SEC-12. Code: `spikes/obsidian-plugin/`.

## Result: works with limitations

Everything that can be verified without driving the Obsidian GUI is verified. Three checks still need a human in the real app (see "Pending").

| Check | Status |
| --- | --- |
| Plugin builds (TypeScript, esbuild, `dist/main.js`) and typechecks against `obsidian` 1.14 types | Verified |
| `requestUrl` client against the local test server (auth, 401, JSON) | Verified in Node with a fetch-based shim of `requestUrl` — **not** in the real app |
| Body bytes unchanged after `processFrontMatter` (6 cases) | Verified against a reference model transcribed from Obsidian 1.12.7 source — **not** the real API |
| Same 6 cases in the real app | Pending: plugin command "Spike: frontmatter self-test" |
| `requestUrl` on desktop app / on mobile via Tailscale | Pending (manual, mobile does not block closing) |

## Findings

### Frontmatter (R-OB-3)

- `fileManager.processFrontMatter(file, fn)` is implemented as `vault.process(file, text => transform(text))` (read from Obsidian 1.12.7 `app.js`). `vault.process` is atomic (read-modify-write in one step), which is what R-OB-3 needs to avoid clobbering in-progress edits.
- The transform only replaces the slice between the opening and closing `---` fences. Everything after the closing fence is copied verbatim, so body bytes (including CRLF and `---` inside the body) are preserved. Cases tested: normal, no frontmatter, empty frontmatter, body containing `---`, CRLF, no trailing newline.
- Behaviours to design around:
  - With no frontmatter, a `---\n…---\n` block is **prepended** (always `\n`, even if the note uses CRLF).
  - In CRLF notes the rewritten frontmatter block is re-serialised with `\n`; only the frontmatter changes, not the body.
  - The frontmatter is re-serialised with `YAML.stringify`: **comments, key quoting style and formatting inside the frontmatter are not preserved**. Body is safe; frontmatter formatting is not.
  - If the callback leaves the object empty, the whole frontmatter block is removed.
  - Invalid YAML throws `YAMLParseError`; the plugin must catch it and skip the note instead of overwriting.
- Recommendation: keep using `processFrontMatter` for all frontmatter writes, and write only the keys Brevolt owns. For body changes use `vault.process`, never `vault.modify` on a stale read.

### Network (R-OB-2)

- Use `requestUrl` (not `fetch`): it bypasses CORS and is the supported API on desktop and mobile. The spike client (`src/client.ts`) sends a Bearer token and throws on non-2xx.
- Mobile: Tailscale gives the phone a reachable address for the server. Plain `http://` to a Tailscale IP/MagicDNS name is expected to work with `requestUrl`; unverified, see manual steps.
- The 3 s debounce and `If-Match` flow (R-OB-2) were out of scope for the spike.

### Settings and secrets (R-SEC-12)

- Plugin settings (`loadData`/`saveData`) are stored as plain JSON in `<vault>/.obsidian/plugins/<plugin-id>/data.json`. This lives **inside the vault**, so it is synced/committed if the user syncs `.obsidian` or puts the vault in git. Never store the token there without a warning.
- Obsidian **does** have a secret store since 1.11.4: `app.secretStorage` (`setSecret(id, value)`, `getSecret(id)`, `listSecrets()`; id = lowercase alphanumerics and dashes, max 64 chars), plus `SecretComponent` for the settings UI. From the 1.12.7 source:
  - Secrets are **app-global, not per vault**, and are not written to the vault or to `.obsidian`.
  - On desktop they are encrypted through Electron `safeStorage` (OS keychain). If encryption is unavailable Obsidian shows a "secrets not encrypted" warning; `setSecret` throws "Secure storage is not available" when there is no storage adapter.
  - Behaviour and availability on iOS/Android was **not** verified.
- Recommendation for the real plugin (BRV-041):
  1. Feature-detect `app.secretStorage`; set `minAppVersion` ≥ 1.11.4 or keep the fallback.
  2. Store the API key there; persist only the secret **id** in `data.json`.
  3. If unavailable (or `setSecret` throws), fall back to `data.json` with a visible warning, minimal token scope and revocation instructions (as R-SEC-12 says).
  4. Because secrets are app-global, the user must re-enter the key on each device; no sync issue.
- The spike plugin reads the token from `secretStorage` (id `brevolt-spike-token`) and falls back to `data.json`. It never writes secrets.

## Pending (manual, test vault only)

Use a **new empty vault**; never a real one. The token below is a fixed synthetic test value.

1. `cd spikes/obsidian-plugin && pnpm install && pnpm build`
2. Create an empty test vault. Copy `dist/main.js` and `manifest.json` to `<vault>/.obsidian/plugins/brevolt-spike/`. Enable community plugins and the plugin.
3. Start the server (foreground; stop with Ctrl+C): `node server/test-server.mjs` (desktop) or `HOST=0.0.0.0 PORT=8787 node server/test-server.mjs` (mobile).
4. Edit `<vault>/.obsidian/plugins/brevolt-spike/data.json`: set `"token": "spike-test-token"` and `serverUrl`.
5. Desktop: command palette → "Spike: ping local server" (expect `Ping ok=true`), then "Spike: frontmatter self-test" (expect 6× PASS).
6. Mobile: install the Tailscale app on both devices; set `serverUrl` to `http://<tailscale-ip>:8787`; copy the plugin folder to the phone's vault (through the test vault sync of your choice) and run the same ping. Report result ("works" / error text) in the issue.
7. Stop the server.
