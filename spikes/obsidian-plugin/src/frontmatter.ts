import type { App, TFile } from "obsidian";

/** R-OB-3: update frontmatter keys through Obsidian's API; never rewrite the whole file. */
export async function applyFrontmatterPatch(app: App, file: TFile, patch: Record<string, unknown>): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const [k, v] of Object.entries(patch)) fm[k] = v;
  });
}
