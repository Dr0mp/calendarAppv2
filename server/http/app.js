import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import { ApiError, forbidden, parse, tooMany, unauthorized } from './errors.js';
import { buildShell, contentSecurityPolicy, personalise } from './html.js';
import { sessionPayload } from './session.js';
import { serveStatic } from './static.js';
import { cookieName, deleteSession, loadSession } from '../auth/sessions.js';
import { hit } from '../auth/ratelimit.js';
import { newId } from '../util.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { userRoutes } from './routes/users.js';
import { venueRoutes } from './routes/venues.js';
import { settingsRoutes } from './routes/settings.js';
import { entryRoutes } from './routes/entries.js';
import { mediaRoutes, mediaFileRoute } from './routes/media.js';
import { socialRoutes } from './routes/social.js';
import { promotionRoutes } from './routes/promotions.js';
import { storageRoutes } from './routes/storage.js';
import { adminRoutes } from './routes/admin.js';
import { testRoutes } from './routes/test.js';
import { loadUser } from '../services/users.js';

/**
 * @typedef {import('../app.js').App} App
 * @typedef {{
 *   Variables: {
 *     app: App, reqId: string, ip: string,
 *     session: any | null, user: any | null, ws: import('../app.js').Workspace | null,
 *   }
 * }} Env
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** @param {import('hono').Context<Env>} c @param {App} app */
function clientIp(c, app) {
  if (app.config.trustProxy) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** @param {App} app */
export function createHttpApp(app) {
  const shell = buildShell(app.config.assets);
  const csp = contentSecurityPolicy(shell);
  app.shell = shell;

  /** @type {Hono<Env>} */
  const h = new Hono();
  // gzip for HTML and JSON; static assets arrive pre-compressed (brotli) and are skipped.
  h.use('*', compress());

  // ---- Request context, logging and security headers ------------------
  h.use('*', async (c, next) => {
    const started = performance.now();
    c.set('app', app);
    c.set('reqId', newId());
    c.set('ip', clientIp(c, app));
    c.set('session', null);
    c.set('user', null);
    c.set('ws', null);
    await next();
    const hd = c.res.headers;
    hd.set('Content-Security-Policy', csp);
    hd.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    hd.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    hd.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    hd.set('Cross-Origin-Opener-Policy', 'same-origin');
    hd.set('Cross-Origin-Resource-Policy', 'same-origin');
    hd.set('X-Content-Type-Options', 'nosniff');
    hd.set('X-Request-Id', c.get('reqId'));
    const path = c.req.path;
    if (path.startsWith('/api/') || path.startsWith('/media/')) {
      app.log.info({
        reqId: c.get('reqId'),
        userId: c.get('user')?.id,
        method: c.req.method,
        route: c.req.routePath,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
      });
    }
  });

  // ---- Session ---------------------------------------------------------
  h.use('*', async (c, next) => {
    const path = c.req.path;
    if (!(path.startsWith('/api/') || path.startsWith('/media/') || !path.includes('.'))) return next();
    const raw = getCookie(c, cookieName(app.config));
    if (raw) {
      const s = loadSession(app.authDb, raw, app.config);
      if (s) {
        const user = loadUser(app.authDb, s.user_id);
        const demoOff = s.workspace === 'demo' && !app.config.demoEnabled;
        if (!user || user.status !== 'active' || demoOff || ((user.is_demo || user.is_seed) && s.workspace !== 'demo')) {
          deleteSession(app.authDb, s.id_hash);
        } else {
          c.set('session', s);
          c.set('user', user);
          c.set('ws', app.workspaces[s.workspace]);
        }
      }
    }
    return next();
  });

  // ---- API ------------------------------------------------------------
  /** @type {Hono<Env>} */
  const api = new Hono();

  // JSON bodies are small; media uploads stream with their own limit.
  const jsonLimit = bodyLimit({ maxSize: 2 * 1024 * 1024, onError: () => { throw new ApiError(413, 'too_large', 'Body too large'); } });
  api.use('*', (c, next) => (c.req.method === 'POST' && c.req.path === '/api/v1/media' ? next() : jsonLimit(c, next)));

  // CSRF: Origin check on every mutating request, plus the session's token when signed in.
  api.use('*', async (c, next) => {
    if (MUTATING.has(c.req.method)) {
      let origin = c.req.header('origin');
      if (!origin) {
        const ref = c.req.header('referer');
        if (ref) {
          try {
            origin = new URL(ref).origin;
          } catch {
            origin = undefined;
          }
        }
      }
      if (!origin || !app.config.origins.includes(origin)) throw forbidden('bad_origin');
      const s = c.get('session');
      if (s) {
        const token = c.req.header('x-csrf-token');
        if (!token || token !== s.csrf_token) throw forbidden('csrf_invalid');
        // Every other write: 300 per 5 min per user.
        if (!c.req.path.startsWith('/api/v1/media')) {
          const r = hit(app.authDb, `write:${s.user_id}`, 300, 5 * 60_000);
          if (!r.ok) throw tooMany(r.retryAfter);
        }
      }
    }
    return next();
  });

  api.get('/health', (c) => c.json({ ok: true, version: app.config.version }));
  api.route('/', authRoutes);
  api.route('/', meRoutes);
  api.route('/', userRoutes);
  api.route('/', venueRoutes);
  api.route('/', settingsRoutes);
  api.route('/', entryRoutes);
  api.route('/', mediaRoutes);
  api.route('/', socialRoutes);
  api.route('/', promotionRoutes);
  api.route('/', storageRoutes);
  api.route('/', adminRoutes);
  if (app.config.isTest) api.route('/', testRoutes);
  api.all('*', () => {
    throw new ApiError(404, 'not_found', 'No such endpoint');
  });

  h.route('/api/v1', api);
  h.route('/', mediaFileRoute);

  // ---- Static assets and the SPA shell --------------------------------
  h.all('*', (c) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.text('Method not allowed', 405);
    const res = serveStatic(c.req.raw, c.req.path);
    if (res) return res;
    // The style guide (/dev/styleguide) exists only outside production; the client checks the admin role.
    if (c.req.path.startsWith('/dev/') && app.config.isProd) return c.text('Not found', 404);
    if (/\.[a-z0-9]+$/i.test(c.req.path)) return c.text('Not found', 404);
    const user = c.get('user');
    c.header('Cache-Control', 'no-store');
    return c.html(personalise(shell, user, c.req.path, sessionPayload(c)));
  });

  h.onError((err, c) => {
    if (err instanceof ApiError) {
      if (err.status === 401 && c.req.path.startsWith('/media/')) return c.text('Unauthorized', 401);
      /** @type {any} */ const body = { error: { code: err.code, message: err.message } };
      if (err.details) body.error.details = err.details;
      if (err.status === 429 && err.details?.retryAfter) c.header('Retry-After', String(err.details.retryAfter));
      return c.json(body, /** @type {any} */ (err.status));
    }
    if (err instanceof SyntaxError) {
      return c.json({ error: { code: 'invalid_json', message: 'Malformed JSON' } }, 400);
    }
    app.log.error({ err, reqId: c.get('reqId') }, 'unhandled error');
    return c.json({ error: { code: 'server_error', message: 'Internal error' } }, 500);
  });

  return h;
}

/** @param {import('hono').Context<Env>} c */
export function requireUser(c) {
  const u = c.get('user');
  if (!u) throw unauthorized();
  return u;
}

/** @param {import('hono').Context<Env>} c */
export function requireAdmin(c) {
  const u = requireUser(c);
  if (u.role !== 'admin') throw forbidden();
  return u;
}

/** Admin or moderator. @param {import('hono').Context<Env>} c */
export function requireStaff(c) {
  const u = requireUser(c);
  if (u.role !== 'admin' && u.role !== 'moderator') throw forbidden();
  return u;
}

/** Demo accounts can never change users, passkeys, passwords or settings. @param {import('hono').Context<Env>} c */
export function requireNotDemo(c) {
  const u = requireUser(c);
  if (u.is_demo) throw forbidden('demo_forbidden');
  return u;
}

/** The workspace of the current session. @param {import('hono').Context<Env>} c */
export function wsOf(c) {
  const ws = c.get('ws');
  if (!ws) throw unauthorized();
  return ws;
}

/** Parse If-Match (W/"3", "3" or 3) into a version number. @param {import('hono').Context<Env>} c */
export function ifMatch(c) {
  const raw = c.req.header('if-match');
  const m = raw && /^(?:W\/)?"?(\d+)"?$/.exec(raw.trim());
  if (!m) throw new ApiError(428, 'if_match_required', 'Send If-Match with the resource version');
  return Number(m[1]);
}

/** Set the ETag for a versioned resource and return it as JSON. @param {import('hono').Context<Env>} c @param {any} body @param {number} [status] */
export function withVersion(c, body, status = 200) {
  if (body && typeof body.version === 'number') c.header('ETag', `W/"${body.version}"`);
  return c.json(body, /** @type {any} */ (status));
}

/** Read and validate a JSON body. @template T @param {import('hono').Context<Env>} c @param {import('zod').ZodType<T>} schema @returns {Promise<T>} */
export async function body(c, schema) {
  let data;
  try {
    data = await c.req.json();
  } catch {
    throw new ApiError(400, 'invalid_json', 'Malformed JSON');
  }
  return parse(schema, data);
}
