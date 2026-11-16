/** Edge-case notes for the frontmatter check. Synthetic content only. */
export interface FrontmatterCase {
  name: string;
  input: string;
  /** Keys set by the mutation under test. */
  mutate: (fm: Record<string, unknown>) => void;
}

/** Body = everything after the closing frontmatter fence (whole file if none). */
export const bodyOf = (c: string): string => {
  const m = /^---\r?\n/.exec(c);
  if (!m) return c;
  const re = /^---(\r?\n|$)/gm;
  re.lastIndex = m[0].length;
  const close = re.exec(c);
  return close ? c.slice(close.index + close[0].length) : c;
};

const set = (fm: Record<string, unknown>) => {
  fm.cf_version = "v2";
  fm.display_name = "Test Person";
};

export const CASES: FrontmatterCase[] = [
  { name: "normal", input: "---\ncf_version: v1\n---\n# Title\n\nBody  with trailing spaces  \n", mutate: set },
  { name: "no frontmatter", input: "# Title\n\nJust a body.\n", mutate: set },
  { name: "empty frontmatter", input: "---\n---\nBody after empty fm\n", mutate: set },
  { name: "body containing ---", input: "---\ncf_version: v1\n---\nText\n\n---\n\nhorizontal rule above\n---\nx: 1\n---\n", mutate: set },
  { name: "CRLF", input: "---\r\ncf_version: v1\r\n---\r\nLine one\r\nLine two\r\n\r\nend", mutate: set },
  { name: "no trailing newline", input: "---\ncf_version: v1\n---\nno newline at end", mutate: set },
];
