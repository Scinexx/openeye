// Local web server for development and tests. Serves public/ and the same /api/*
// handler the Cloudflare Worker uses. Not used in production.
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join, normalize, extname, sep, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeApi, handleApiRequest, SECURITY_HEADERS} from '../core/site.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

function makeLimiter(perMinute) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [k, e] of hits) if (e.start < cutoff) hits.delete(k);
  }, 60_000).unref();
  return key => {
    const t = Date.now();
    const e = hits.get(key);
    if (!e || t - e.start >= 60_000) { hits.set(key, {start: t, n: 1}); return true; }
    return ++e.n <= perMinute;
  };
}

function resolvePublic(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.startsWith('/_')) return null;
  const target = normalize(join(PUBLIC, decoded));
  return target.startsWith(PUBLIC + sep) ? target : null;
}

async function sendFile(res, method, file, status = 200) {
  const body = await readFile(file);
  res.writeHead(status, {...SECURITY_HEADERS, 'content-type': MIME[extname(file)] ?? 'application/octet-stream'});
  res.end(method === 'HEAD' ? undefined : body);
}

export function startServer(db, settings, {port = 3000, host = '127.0.0.1', rateLimitPerMinute = 240, log = console} = {}) {
  const catalog = {items: JSON.parse(readFileSync(join(PUBLIC, 'catalog/items.json'), 'utf8'))};
  const api = makeApi(db, catalog, settings);
  const allow = makeLimiter(rateLimitPerMinute);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        const response = await handleApiRequest(new Request(url, {method: req.method}), {
          api, allow, clientKey: req.socket.remoteAddress ?? 'unknown', log
        });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        return res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, SECURITY_HEADERS);
        return res.end();
      }
      const file = url.pathname === '/' ? null : resolvePublic(url.pathname);
      if (file && (await stat(file).catch(() => null))?.isFile()) return await sendFile(res, req.method, file);
      // Single-page app: every other path renders index.html (same as Workers' SPA mode).
      await sendFile(res, req.method, join(PUBLIC, 'index.html'));
    } catch (e) {
      log.error(e);
      res.writeHead(500, SECURITY_HEADERS);
      res.end();
    }
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.listen(port, host, () => log.info(`OpenEye is running at http://${host}:${server.address().port}`));
  return server;
}
