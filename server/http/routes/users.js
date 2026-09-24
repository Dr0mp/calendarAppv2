import { Hono } from 'hono';
import { body, ifMatch, requireAdmin, requireUser, withVersion, wsOf } from '../app.js';
import { ApiError, conflict, forbidden, notFound } from '../errors.js';
import { DeleteUser, DemoInviteUser, InviteUser, LinkRequest, UpdateUser } from '../../../shared/schemas/user.js';
import {
  assertRoleChangeAllowed, directoryView, insertUser, loadUser, setStatus, updateUser, visibilityClause, initialsOf,
} from '../../services/users.js';
import { revokeUserSessions } from '../../auth/sessions.js';
import { createToken } from '../../auth/tokens.js';
import { composeMail } from '../../auth/email.js';
import { todayIn } from '../../../shared/rules/time.js';
import { isoNow } from '../../util.js';

/** @type {Hono<import('../app.js').Env>} */
export const userRoutes = new Hono();

/** Demo admins can look, but never change users. @param {any} c */
function requireRealAdmin(c) {
  const u = requireAdmin(c);
  if (u.is_demo) throw forbidden('demo_forbidden');
  return u;
}

/**
 * Who may add, edit or delete people: real admins manage real accounts; in
 * the demo, the demo admin manages demo-only people (seed users: no email,
 * no password, cannot sign in, removed at the next demo reset).
 * @param {any} c @param {any} [target]
 */
function requireUserManager(c, target) {
  const u = requireAdmin(c);
  if (u.is_demo) {
    if (wsOf(c).name !== 'demo' || (target && !target.is_seed)) throw forbidden('demo_forbidden');
  } else if (target && (target.is_demo || target.is_seed)) throw forbidden('demo_forbidden');
  return u;
}

/** A free demo-only username in the seed. namespace. @param {any} db @param {string} wanted */
function demoUsername(db, wanted) {
  const base = (wanted.startsWith('seed.') ? wanted : `seed.${wanted}`).slice(0, 29);
  let name = base;
  for (let i = 2; db.prepare('SELECT 1 FROM users WHERE username = ?').get(name); i++) name = `${base}-${i}`;
  return name;
}

/** A user visible in the caller's workspace, or 404. @param {any} c @param {string} id */
function visibleUser(c, id) {
  const app = c.get('app');
  const ws = wsOf(c);
  const u = loadUser(app.authDb, id);
  const inDemo = u && (u.is_demo || u.is_seed);
  if (!u || (ws.name === 'demo') !== !!inDemo) throw notFound('user_not_found');
  return u;
}

/** @param {any} c @param {any} u */
function adminView(c, u) {
  const app = c.get('app');
  const ws = wsOf(c);
  const today = todayIn(ws.tz());
  const upcoming = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM entries WHERE owner_id = ? AND last_date >= ?').get(u.id, today)).n;
  const passkeys = /** @type {any} */ (app.authDb.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').get(u.id)).n;
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    isRoot: !!u.is_root,
    isDemo: !!u.is_demo,
    isSeed: !!u.is_seed,
    color: u.color,
    initials: u.initials || initialsOf(u.name),
    passkeys,
    upcoming,
    lastLoginAt: u.last_login_at,
    legacyPassword: typeof u.password_hash === 'string' && u.password_hash.startsWith('legacy-bcrypt:'),
    createdAt: u.created_at,
    version: u.version,
  };
}

userRoutes.get('/users/directory', (c) => {
  requireUser(c);
  const app = c.get('app');
  const ws = wsOf(c);
  const rows = app.authDb.prepare(`SELECT * FROM users WHERE ${visibilityClause(ws.name)} ORDER BY name COLLATE NOCASE`).all();
  return c.json({ items: rows.map(directoryView), nextCursor: null });
});

userRoutes.get('/users', (c) => {
  requireAdmin(c);
  const app = c.get('app');
  const ws = wsOf(c);
  const rows = app.authDb.prepare(`SELECT * FROM users WHERE ${visibilityClause(ws.name)} ORDER BY name COLLATE NOCASE`).all();
  return c.json({ items: rows.map((u) => adminView(c, u)), nextCursor: null, email: app.mailer.configured });
});

userRoutes.get('/users/:id', (c) => {
  requireAdmin(c);
  return withVersion(c, adminView(c, visibleUser(c, c.req.param('id'))));
});

/** Send (when possible) or return a link. @param {any} c @param {any} u @param {'invite'|'reset'} purpose @param {boolean} send */
async function issueLink(c, u, purpose, send) {
  const app = c.get('app');
  const token = createToken(app.authDb, u.id, purpose);
  const link = `${app.config.appUrl}/${purpose}/${token}`;
  if (send && app.mailer.configured && u.email) {
    const mail = composeMail(purpose, u.locale, u.name, link);
    await app.mailer.send({ to: u.email, ...mail });
    return { emailed: true, link: null };
  }
  return { emailed: false, link };
}

userRoutes.post('/users', async (c) => {
  const actor = requireUserManager(c);
  const app = c.get('app');
  if (actor.is_demo) {
    // Demo: a test person only. No email is kept or sent, no password, no sign-in.
    const data = await body(c, DemoInviteUser);
    const u = insertUser(app.authDb, {
      name: data.name, username: demoUsername(app.authDb, data.username), role: data.role, color: data.color,
      isSeed: true, status: 'active', createdBy: actor.id,
    });
    return c.json({ user: adminView(c, u), emailed: false, link: null, demo: true }, 201);
  }
  const data = await body(c, InviteUser);
  const u = insertUser(app.authDb, { ...data, status: 'invited', createdBy: actor.id });
  const out = await issueLink(c, u, 'invite', true);
  return c.json({ user: adminView(c, u), ...out }, 201);
});

userRoutes.patch('/users/:id', async (c) => {
  const app = c.get('app');
  const target = visibleUser(c, c.req.param('id'));
  const actor = requireUserManager(c, target);
  const patch = await body(c, UpdateUser);
  const version = ifMatch(c);
  // Demo people keep their demo username and never get an email address.
  if (actor.is_demo && ((patch.username && patch.username !== target.username) || patch.email)) throw forbidden('demo_forbidden');
  if (patch.role && patch.role !== target.role) assertRoleChangeAllowed(target, patch.role);
  if (patch.username && target.is_root && patch.username !== target.username) throw forbidden('root_protected');
  const { status, ...fields } = patch;
  app.authDb.tx(() => {
    const u = updateUser(app.authDb, target, fields, version, actor.id);
    if (status && status !== u.status) setStatus(app.authDb, u, status, actor.id);
    // Privilege changes revoke the user's sessions.
    if (patch.role && patch.role !== target.role) revokeUserSessions(app.authDb, target.id);
  });
  return withVersion(c, adminView(c, loadUser(app.authDb, target.id)));
});

userRoutes.post('/users/:id/invite', async (c) => {
  requireRealAdmin(c);
  const u = visibleUser(c, c.req.param('id'));
  const { send } = await body(c, LinkRequest);
  if (u.status !== 'invited') throw new ApiError(409, 'already_active', 'User already activated');
  return c.json(await issueLink(c, u, 'invite', send ?? true));
});

userRoutes.post('/users/:id/reset-link', async (c) => {
  requireRealAdmin(c);
  const u = visibleUser(c, c.req.param('id'));
  const { send } = await body(c, LinkRequest);
  if (u.status !== 'active') throw new ApiError(409, 'user_not_active', 'User is not active');
  return c.json(await issueLink(c, u, 'reset', send ?? true));
});

userRoutes.delete('/users/:id/passkeys', (c) => {
  requireRealAdmin(c);
  const u = visibleUser(c, c.req.param('id'));
  const n = c.get('app').authDb.prepare('DELETE FROM passkeys WHERE user_id = ?').run(u.id).changes;
  return c.json({ ok: true, removed: n });
});

userRoutes.delete('/users/:id/sessions', (c) => {
  requireRealAdmin(c);
  const u = visibleUser(c, c.req.param('id'));
  return c.json({ ok: true, removed: revokeUserSessions(c.get('app').authDb, u.id) });
});

userRoutes.post('/users/:id/transfer-root', (c) => {
  const actor = requireRealAdmin(c);
  const app = c.get('app');
  if (!actor.is_root) throw forbidden('root_only');
  const target = visibleUser(c, c.req.param('id'));
  if (target.role !== 'admin' || target.status !== 'active' || target.is_demo || target.is_seed) {
    throw new ApiError(400, 'root_target_invalid', 'The new root must be an active admin');
  }
  app.authDb.tx(() => {
    const now = isoNow();
    app.authDb.prepare('UPDATE users SET is_root = 0, version = version + 1, updated_at = ? WHERE id = ?').run(now, actor.id);
    app.authDb.prepare('UPDATE users SET is_root = 1, version = version + 1, updated_at = ? WHERE id = ?').run(now, target.id);
  });
  return c.json({ ok: true });
});

userRoutes.delete('/users/:id', async (c) => {
  const ws = wsOf(c);
  const target = visibleUser(c, c.req.param('id'));
  const actor = requireUserManager(c, target);
  const { transferTo, keepPast } = await body(c, DeleteUser);
  const version = ifMatch(c);
  if (target.version !== version) throw conflict('version_conflict', { current: target.version });
  if (target.is_root) throw forbidden('root_protected');
  if (target.id === actor.id) throw forbidden('cannot_delete_self');
  const today = todayIn(ws.tz());
  /** @type {any} */ let dest = null;
  if (transferTo) {
    dest = visibleUser(c, transferTo);
    if (dest.id === target.id || dest.status === 'disabled') throw new ApiError(400, 'transfer_target_invalid');
  }
  // Real people own content in main; demo people only in the demo workspace.
  const main = ws.db;
  const upcoming = /** @type {any} */ (main.prepare('SELECT COUNT(*) AS n FROM entries WHERE owner_id = ? AND last_date >= ?').get(target.id, today)).n;
  if (upcoming && !dest) throw conflict('has_upcoming_entries', { count: upcoming });
  main.tx(() => {
    if (dest) {
      main.prepare('UPDATE entries SET owner_id = ?, owner_name_snapshot = ?, version = version + 1 WHERE owner_id = ? AND last_date >= ?').run(dest.id, dest.name, target.id, today);
      if (!keepPast) {
        main.prepare('UPDATE entries SET owner_id = ?, owner_name_snapshot = ?, version = version + 1 WHERE owner_id = ?').run(dest.id, dest.name, target.id);
      }
    }
    // Remaining (past) entries keep owner_name_snapshot and show as "former user".
    main.prepare('DELETE FROM media_owners WHERE user_id = ?').run(target.id);
    main.prepare('DELETE FROM auth.users WHERE id = ?').run(target.id);
  });
  return c.json({ ok: true });
});

userRoutes.get('/users/:id/export', (c) => {
  requireAdmin(c);
  const app = c.get('app');
  const ws = wsOf(c);
  const u = visibleUser(c, c.req.param('id'));
  const entries = ws.db.prepare('SELECT * FROM entries WHERE owner_id = ? ORDER BY first_date').all(u.id);
  const sessions = ws.db.prepare('SELECT s.* FROM entry_sessions s JOIN entries e ON e.id = s.entry_id WHERE e.owner_id = ? ORDER BY s.date, s.start_time').all(u.id);
  const bookings = ws.db.prepare('SELECT b.* FROM room_bookings b JOIN entries e ON e.id = b.entry_id WHERE e.owner_id = ?').all(u.id);
  const uploads = ws.db
    .prepare('SELECT m.id, m.original_name, m.mime, m.bytes, m.width, m.height, mo.created_at FROM media_owners mo JOIN media m ON m.id = mo.media_id WHERE mo.user_id = ?')
    .all(u.id);
  const passkeys = app.authDb.prepare('SELECT name, created_at, last_used_at FROM passkeys WHERE user_id = ?').all(u.id);
  const profile = {
    id: u.id, username: u.username, email: u.email, name: u.name, role: u.role, status: u.status, color: u.color,
    locale: u.locale, theme: u.theme, last_login_at: u.last_login_at, created_at: u.created_at,
  };
  c.header('Content-Disposition', `attachment; filename="export-${u.username}.json"`);
  return c.json({ exportedAt: isoNow(), profile, passkeys, entries, sessions, bookings, uploads });
});
