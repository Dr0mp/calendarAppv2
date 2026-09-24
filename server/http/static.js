import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.resolve(import.meta.dirname, '../../public');
const SHARED = path.resolve(import.meta.dirname, '../../shared');

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
};

/** URL prefix → [root dir, cache policy] */
const MOUNTS = [
  ['/vendor/', PUBLIC, 'public, max-age=31536000, immutable'],
  ['/fonts/', PUBLIC, 'public, max-age=31536000, immutable'],
  ['/app/', PUBLIC, 'no-cache'],
  ['/styles/', PUBLIC, 'no-cache'],
  ['/shared/', SHARED, 'no-cache'],
  ['/icons.svg', PUBLIC, 'no-cache'],
  ['/favicon.svg', PUBLIC, 'public, max-age=86400'],
  ['/sample/', PUBLIC, 'public, max-age=86400'],
];

/**
 * Serve the static front end. Returns null when the path is not a static asset.
 * @param {Request} req
 * @param {string} pathname
 */
export function serveStatic(req, pathname) {
  const mount = MOUNTS.find(([p]) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));
  if (!mount) return null;
  const [prefix, root, cache] = mount;
  const rel = root === SHARED ? pathname.slice(prefix.length) : pathname.slice(1);
  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const file = path.resolve(root, decoded);
  if (!file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
  // Shared code is served only for the browser-safe folders.
  if (root === SHARED && !/^(schemas|rules)\//.test(decoded)) return new Response('Not found', { status: 404 });
  const type = TYPES[path.extname(file)];
  if (!type) return new Response('Not found', { status: 404 });
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = { 'Content-Type': type, 'Cache-Control': cache, ETag: etag };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  if (req.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(fs.readFileSync(file), { status: 200, headers });
}
