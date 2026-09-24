import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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
 * The stylesheets, in cascade order, served as one file (/styles/app.css)
 * so the first paint waits for one request instead of eight. The sources
 * stay separate files for editing and linting.
 */
export const STYLESHEETS = ['tokens', 'base', 'layout', 'components', 'pages', 'calendar', 'social', 'utilities'];

/** @type {{key: string, body: Buffer}|null} */
let bundle = null;
function cssBundle() {
  const files = STYLESHEETS.map((n) => path.join(PUBLIC, 'styles', `${n}.css`));
  const stats = files.map((f) => fs.statSync(f));
  const key = stats.map((st) => `${st.size}-${Math.floor(st.mtimeMs)}`).join('.');
  if (bundle?.key !== key) {
    bundle = { key, body: Buffer.from(files.map((f, i) => `/* ${STYLESHEETS[i]}.css */\n${fs.readFileSync(f, 'utf8')}`).join('\n')) };
  }
  return bundle;
}

const COMPRESSIBLE = /^(text\/|application\/json|image\/svg)/;
/** @type {Map<string, Buffer>} */
const compressed = new Map();

/**
 * The body, brotli- or gzip-compressed when the client accepts it. Results
 * are cached per file version (the ETag), so each file is compressed once.
 * @param {Request} req @param {Buffer} body @param {string} type @param {string} key file path + version
 * @param {Record<string, string>} headers
 * @returns {Uint8Array<ArrayBuffer>}
 */
function encode(req, body, type, key, headers) {
  if (!COMPRESSIBLE.test(type) || body.length < 1024) return /** @type {Uint8Array<ArrayBuffer>} */ (new Uint8Array(body));
  headers.Vary = 'Accept-Encoding';
  const accept = req.headers.get('accept-encoding') ?? '';
  const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
  if (!enc) return /** @type {Uint8Array<ArrayBuffer>} */ (new Uint8Array(body));
  const cacheKey = `${key}:${enc}`;
  let out = compressed.get(cacheKey);
  if (!out) {
    out =
      enc === 'br'
        ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
        : zlib.gzipSync(body, { level: 9 });
    if (compressed.size > 2000) compressed.clear();
    compressed.set(cacheKey, out);
  }
  headers['Content-Encoding'] = enc;
  return /** @type {Uint8Array<ArrayBuffer>} */ (new Uint8Array(out));
}

/**
 * Serve the static front end. Returns null when the path is not a static asset.
 * @param {Request} req
 * @param {string} pathname
 */
export function serveStatic(req, pathname) {
  if (pathname === '/styles/app.css') {
    const b = cssBundle();
    const etag = `W/"css-${b.key}"`;
    /** @type {Record<string, string>} */ const headers = { 'Content-Type': TYPES['.css'], 'Cache-Control': 'no-cache', ETag: etag };
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    const body = encode(req, b.body, TYPES['.css'], `app.css:${etag}`, headers);
    return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers });
  }
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
  /** @type {Record<string, string>} */ const headers = { 'Content-Type': type, 'Cache-Control': cache, ETag: etag };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  if (req.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(encode(req, fs.readFileSync(file), type, `${file}:${etag}`, headers), { status: 200, headers });
}
