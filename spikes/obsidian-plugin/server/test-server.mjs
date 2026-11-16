// Minimal local HTTP server for the BRV-003 spike. Synthetic data only.
//   GET /v1/ping           -> {ok:true}
//   GET /v1/contacts/spike -> synthetic frontmatter patch
// Both require `Authorization: Bearer spike-test-token`.
// CLI: HOST=0.0.0.0 PORT=8787 node server/test-server.mjs   (Ctrl+C to stop)
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const TEST_TOKEN = "spike-test-token"; // fixed, test-only, not a real credential
export const SYNTHETIC_PATCH = { cf_version: "v2", display_name: "Test Person", tags: ["spike"] };

export function createTestServer() {
  return createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) return send(401, { error: "unauthorized" });
    if (req.method === "GET" && req.url === "/v1/ping") return send(200, { ok: true });
    if (req.method === "GET" && req.url === "/v1/contacts/spike") return send(200, SYNTHETIC_PATCH);
    return send(404, { error: "not found" });
  });
}

export function listen(server, port = 0, host = "127.0.0.1") {
  return new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = await listen(createTestServer(), Number(process.env.PORT ?? 8787), process.env.HOST ?? "127.0.0.1");
  console.log(`spike server listening on ${process.env.HOST ?? "127.0.0.1"}:${port}`);
}
