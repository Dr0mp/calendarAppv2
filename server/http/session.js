import { setCookie, deleteCookie } from 'hono/cookie';
import { cookieName, createSession } from '../auth/sessions.js';
import { selfView } from '../services/users.js';
import { allSettings } from '../services/settings.js';
import { storageStatus } from '../services/storage.js';
import { DAY } from '../util.js';

/**
 * Start a session for `user` in `workspace` and set the cookie. Any previous
 * session on this browser is replaced (session id rotation).
 * @param {import('hono').Context<import('./app.js').Env>} c
 * @param {any} user
 * @param {'main'|'demo'} workspace
 */
export function signIn(c, user, workspace) {
  const app = c.get('app');
  const prev = c.get('session');
  if (prev) app.authDb.prepare('DELETE FROM sessions WHERE id_hash = ?').run(prev.id_hash);
  const { value, session } = createSession(
    app.authDb,
    { userId: user.id, workspace, userAgent: c.req.header('user-agent'), ip: c.get('ip') },
    app.config,
  );
  setCookie(c, cookieName(app.config), value, {
    httpOnly: true,
    secure: app.config.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor((app.config.sessionTtlDays * DAY) / 1000),
  });
  c.set('session', session);
  c.set('user', user);
  c.set('ws', app.workspaces[workspace]);
  return session;
}

/** @param {import('hono').Context<import('./app.js').Env>} c */
export function clearCookie(c) {
  const app = c.get('app');
  deleteCookie(c, cookieName(app.config), { path: '/', secure: app.config.secureCookies });
}

/**
 * The `GET /session` payload.
 * @param {import('hono').Context<import('./app.js').Env>} c
 */
export function sessionPayload(c) {
  const app = c.get('app');
  const user = c.get('user');
  const session = c.get('session');
  const ws = c.get('ws') ?? app.workspaces.main;
  const s = allSettings(ws.db);
  const passkeys = user
    ? /** @type {any} */ (app.authDb.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').get(user.id)).n
    : 0;
  // Users who had passkeys in v1 are invited to add a new one (v1 keys can't be migrated).
  const passkeyInvite = !!user && !passkeys && !user.is_demo && (JSON.parse(s.v1_passkey_users || '[]')).includes(user.id);
  return {
    user: user ? { ...selfView(user), passkeyCount: passkeys, passkeyInvite } : null,
    workspace: session ? session.workspace : null,
    csrfToken: session ? session.csrf_token : null,
    settings: { tz: s.tz, orgName: s.org_name, defaultLocale: s.default_locale },
    features: { demo: app.config.demoEnabled, email: app.mailer.configured, dev: !app.config.isProd },
    storage: user?.role === 'admin' ? storageStatus(app, ws).level : null,
  };
}
