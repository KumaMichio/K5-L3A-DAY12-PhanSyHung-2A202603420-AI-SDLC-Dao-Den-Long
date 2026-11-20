// Tiny static server for dist-web (+ optional leaderboard API). Shared by play.mjs and bench.mjs.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/** @param {string} root @param {{ api?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, body: string) => boolean }} opts */
export function serve(root, opts = {}) {
  const base = resolve(root);
  if (!existsSync(join(base, 'index.html'))) throw new Error(`${base}/index.html not found: run "npm run build" first`);
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      if (opts.api && opts.api(req, res, body)) return;
      const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
      const file = normalize(join(base, url === '/' ? 'index.html' : url));
      if (!file.startsWith(base) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    });
  });
  return new Promise((ok) => server.listen(opts.port ?? 0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}
