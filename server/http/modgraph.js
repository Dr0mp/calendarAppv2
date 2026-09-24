// Module preloads for the first paint. There is no build step, so the
// browser would discover the app's ES modules one import level at a time.
// The server walks the static import graph of the shell and of the page
// being opened, and lists every module as <link rel="modulepreload">, so
// they all download in parallel.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');

/** Static `import … from '…'`, `import '…'` and `export … from '…'` (not `import()`). */
const IMPORT_RE = /(?:^|[;\n}])\s*(?:import\s+(?:[\w*{}\s,$]+?\s+from\s+)?|export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+)['"]([^'"\n]+)['"]/g;

/** Page module for each route (see public/app/router.js). */
const ROUTES = /** @type {[RegExp, string][]} */ ([
  [/^\/(calendar)?$/, '/app/pages/calendar/calendar.js'],
  [/^\/schedule$|^\/entries\/[^/]+\/edit$/, '/app/pages/schedule/schedule.js'],
  [/^\/entries\/[^/]+$/, '/app/pages/entry/entry-page.js'],
  [/^\/my-events$/, '/app/pages/my-entries/my-entries.js'],
  [/^\/social$/, '/app/pages/social/social.js'],
  [/^\/social\/queue$/, '/app/pages/social/queue.js'],
  [/^\/social\/platforms$/, '/app/pages/social/platforms.js'],
  [/^\/social\/standards$/, '/app/pages/social/standards.js'],
  [/^\/admin(\/.*)?$/, '/app/pages/admin/admin.js'],
  [/^\/account$/, '/app/pages/account/account.js'],
  [/^\/login$/, '/app/pages/login/login.js'],
]);

/**
 * @param {string} url absolute URL path of a module
 * @returns {string|null} its file, when it is ours
 */
function fileOf(url) {
  if (url.startsWith('/shared/')) return path.join(SHARED, url.slice('/shared/'.length));
  if (url.startsWith('/app/') || url.startsWith('/vendor/')) return path.join(PUBLIC, url.slice(1));
  return null;
}

/**
 * Resolve a specifier as the browser would, using the import map for bare
 * names. Only same-origin results are returned (CDN modules are skipped).
 * @param {string} spec @param {string} from @param {{imports: Record<string, string>}} map
 */
export function resolveSpecifier(spec, from, map) {
  let url;
  if (spec.startsWith('./') || spec.startsWith('../')) url = new URL(spec, `http://x${from}`).pathname;
  else if (spec.startsWith('/')) url = spec;
  else {
    const exact = map.imports[spec];
    const prefix = exact ? null : Object.keys(map.imports).find((k) => k.endsWith('/') && spec.startsWith(k));
    url = exact ?? (prefix ? map.imports[prefix] + spec.slice(prefix.length) : null);
  }
  return url && url.startsWith('/') ? url : null;
}

/** @type {Map<string, {mtime: number, deps: string[]}>} */
const cache = new Map();

/** @param {string} url @param {{imports: Record<string, string>}} map */
function depsOf(url, map) {
  const file = fileOf(url);
  if (!file) return [];
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return [];
  }
  const hit = cache.get(url);
  if (hit && hit.mtime === stat.mtimeMs) return hit.deps;
  const src = fs.readFileSync(file, 'utf8');
  const deps = [...src.matchAll(IMPORT_RE)].map((m) => resolveSpecifier(m[1], url, map)).filter((u) => u !== null);
  cache.set(url, { mtime: stat.mtimeMs, deps: /** @type {string[]} */ (deps) });
  return /** @type {string[]} */ (deps);
}

/**
 * Every module the shell and this route's page load statically.
 * @param {string} pathname @param {{imports: Record<string, string>}} map
 */
export function preloadsFor(pathname, map) {
  const page = ROUTES.find(([re]) => re.test(pathname))?.[1];
  const entries = ['/app/main.js', '/app/boot.js', '/app/shell.js', ...(page ? [page] : [])];
  const polyfill = resolveSpecifier('temporal-polyfill', '/app/main.js', map);
  if (polyfill) entries.push(polyfill);
  /** @type {Set<string>} */ const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const url = /** @type {string} */ (stack.pop());
    if (seen.has(url)) continue;
    seen.add(url);
    stack.push(...depsOf(url, map));
  }
  return [...seen];
}
