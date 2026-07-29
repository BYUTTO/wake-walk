// Minimal static server. No dependencies on purpose — same reasoning as the rest of the
// line: ES modules need a real origin because file:// trips CORS on every import, and a
// dev-server package would be the only entry in package.json.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 5183);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';

    // Contain path traversal: resolve, then verify the result is still under ROOT.
    const full = normalize(join(ROOT, path));
    if (!full.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(full)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500);
    res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}).listen(PORT, () => {
  console.log(`Wake Walk running at http://localhost:${PORT}`);
});
