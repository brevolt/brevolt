import { Notice, Plugin, TFile } from "obsidian";
import { fetchPatch, ping, type SpikeClientConfig } from "./client";
import { applyFrontmatterPatch } from "./frontmatter";
import { CASES, bodyOf } from "./frontmatter-cases";

const SECRET_ID = "brevolt-spike-token";
const SELFTEST_DIR = "brevolt-spike-selftest";

interface SpikeSettings {
  serverUrl: string;
  /** Fallback only: lives in plain text in data.json (inside the vault). */
  token: string;
}

const DEFAULTS: SpikeSettings = { serverUrl: "http://127.0.0.1:8787", token: "" };

export default class BrevoltSpikePlugin extends Plugin {
  settings: SpikeSettings = { ...DEFAULTS };

  async onload() {
    this.settings = { ...DEFAULTS, ...(await this.loadData()) };
    // Persist defaults so data.json exists and the user can edit serverUrl/token there (no settings UI in the spike).
    await this.saveData(this.settings);

    this.addCommand({ id: "ping", name: "Spike: ping local server", callback: () => this.run(() => this.cmdPing()) });
    this.addCommand({
      id: "patch-active",
      name: "Spike: apply server patch to active note frontmatter",
      callback: () => this.run(() => this.cmdPatch()),
    });
    this.addCommand({ id: "selftest", name: "Spike: frontmatter self-test (creates temp notes)", callback: () => this.run(() => this.cmdSelfTest()) });
    this.addCommand({ id: "secrets", name: "Spike: report secret storage availability", callback: () => this.run(() => this.cmdSecrets()) });
  }

  private async run(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      new Notice(`Spike error: ${(e as Error).message}`, 10000);
    }
  }

  /** Prefers the Obsidian secret store (>= 1.11.4); falls back to data.json. */
  private token(): string {
    return this.app.secretStorage?.getSecret(SECRET_ID) ?? this.settings.token;
  }

  private cfg(): SpikeClientConfig {
    return { baseUrl: this.settings.serverUrl, token: this.token() };
  }

  private async cmdPing() {
    const r = await ping(this.cfg());
    new Notice(`Ping ok=${r.ok}`);
  }

  private async cmdPatch() {
    const file = this.app.workspace.getActiveFile();
    if (!file) throw new Error("No active note");
    await applyFrontmatterPatch(this.app, file, await fetchPatch(this.cfg()));
    new Notice(`Patched ${file.path}`);
  }

  private async cmdSecrets() {
    const s = this.app.secretStorage;
    new Notice(s ? `secretStorage present; ${s.listSecrets().length} secrets (ids only)` : "secretStorage NOT available");
  }

  /** Runs every edge case in the real app and compares the body byte by byte. */
  private async cmdSelfTest() {
    const { vault } = this.app;
    if (!vault.getFolderByPath(SELFTEST_DIR)) await vault.createFolder(SELFTEST_DIR);
    const lines: string[] = [];
    for (const [i, c] of CASES.entries()) {
      const path = `${SELFTEST_DIR}/case-${i}.md`;
      const existing = vault.getAbstractFileByPath(path);
      if (existing) await vault.delete(existing);
      const file: TFile = await vault.create(path, c.input);
      await applyFrontmatterPatch(this.app, file, { cf_version: "v2", display_name: "Test Person" });
      const before = new TextEncoder().encode(bodyOf(c.input));
      const afterText = await vault.read(file);
      const after = new TextEncoder().encode(bodyOf(afterText));
      const ok = before.length === after.length && before.every((b, k) => b === after[k]);
      lines.push(`${ok ? "PASS" : "FAIL"} ${c.name}`);
      await vault.delete(file);
    }
    console.log(`[brevolt-spike] self-test\n${lines.join("\n")}`);
    new Notice(lines.join("\n"), 15000);
  }
}
