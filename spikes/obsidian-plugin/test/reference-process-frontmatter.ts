import { parse, stringify } from "yaml";

/**
 * Reference model of Obsidian's `processFrontMatter` text transform.
 * Transcribed from Obsidian 1.12.7 (obsidian.asar/app.js: functions `vI`, `Xx`, regexes `Yx`/`Qx`;
 * parseYaml = YAML.parse, stringifyYaml = YAML.stringify from the `yaml` package).
 * This is NOT the real thing: the in-app self-test command is the authoritative check.
 */
const OPEN = /^---(\r?\n)/g;
const CLOSE = /---(\r?\n|$)/g;

function info(text: string) {
  OPEN.lastIndex = 0;
  if (!OPEN.exec(text)) return { exists: false, from: 0, to: 0, contentStart: 0, frontmatter: "" };
  const from = OPEN.lastIndex;
  CLOSE.lastIndex = from;
  let m = CLOSE.exec(text);
  while (m && text.charAt(m.index - 1) !== "\n") m = CLOSE.exec(text);
  if (!m) return { exists: false, from: 0, to: 0, contentStart: 0, frontmatter: "" };
  return { exists: true, from, to: m.index, contentStart: CLOSE.lastIndex, frontmatter: text.slice(from, m.index) };
}

export function referenceProcessFrontMatter(text: string, fn: (fm: Record<string, unknown>) => void): string {
  const i = info(text);
  let fm: unknown = i.exists ? parse(i.frontmatter) : {};
  if (!fm || typeof fm !== "object") fm = {};
  fn(fm as Record<string, unknown>);
  if (Object.keys(fm as object).length === 0) return i.exists ? text.slice(i.contentStart) : text;
  const yaml = stringify(fm);
  return i.exists ? text.slice(0, i.from) + yaml + text.slice(i.to) : "---\n" + yaml + "---\n" + text;
}
