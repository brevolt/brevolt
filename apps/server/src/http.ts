import { createServer, type Server } from 'node:http';

/** Minimal liveness endpoint. The full health report lives in BRV-024. */
export function createHttpServer(): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/healthz') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' }).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
}
