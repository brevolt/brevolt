import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { fetchPatch, ping } from "../src/client";
import { CASES, bodyOf } from "../src/frontmatter-cases";
import { SYNTHETIC_PATCH, TEST_TOKEN, createTestServer, listen } from "../server/test-server.mjs";
import { referenceProcessFrontMatter } from "./reference-process-frontmatter";

const bytes = (s: string) => Buffer.from(s, "utf8");

describe("frontmatter edit leaves body bytes untouched (reference model)", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const out = referenceProcessFrontMatter(c.input, c.mutate);
      expect(bytes(bodyOf(out)).equals(bytes(bodyOf(c.input)))).toBe(true);
      expect(out).toContain("cf_version: v2");
    });
  }
});

describe("local server via requestUrl", () => {
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    server = createTestServer();
    baseUrl = `http://127.0.0.1:${await listen(server)}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("ping and patch with a valid token", async () => {
    const cfg = { baseUrl, token: TEST_TOKEN };
    expect(await ping(cfg)).toEqual({ ok: true });
    expect(await fetchPatch(cfg)).toEqual(SYNTHETIC_PATCH);
  });

  it("rejects a bad token", async () => {
    await expect(ping({ baseUrl, token: "wrong" })).rejects.toThrow(/401/);
  });
});
