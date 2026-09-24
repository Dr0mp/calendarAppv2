import crypto from 'node:crypto';
import { newId, isoNow } from '../util.js';
import { OWNER_COLORS } from '../../shared/schemas/common.js';
import { ApiError, conflict, forbidden, notFound } from '../http/errors.js';
import { revokeUserSessions } from '../auth/sessions.js';

/** @typedef {import('../db/open.js').Db} Db */

/** @param {Db} db @param {string} id */
export function loadUser(db, id) {
  return /** @type {any} */ (db.prepare('SELECT * FROM users WHERE id = ?').get(id)) ?? null;
}

/** @param {Db} db @param {string} login username or email */
export function findByLogin(db, login) {
  return /** @type {any} */ (
    db.prepare('SELECT * FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)').get(login, login.toLowerCase())
  ) ?? null;
}

/** Initials from a display name, e.g. "Anca Popescu" → "AP". @param {string} name */
export function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]][0] ?? '';
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] ?? '' : [...parts[0]][1] ?? '';
  return (first + last).toUpperCase();
}

/** Fields safe to send to the user themselves. @param {any} u */
export function selfView(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.name,
    role: u.role,
    isRoot: !!u.is_root,
    isDemo: !!u.is_demo,
    initials: u.initials || initialsOf(u.name),
    color: u.color,
    locale: u.locale,
    theme: u.theme,
    status: u.status,
    version: u.version,
  };
}

/** Directory entry for calendars. @param {any} u */
export const directoryView = (u) => ({
  id: u.id,
  name: u.name,
  color: u.color,
  role: u.role,
  initials: u.initials || initialsOf(u.name),
});

/**
 * Who is visible in a workspace: in main only real users; in the demo only
 * the demo accounts and the fictitious seed users.
 * @param {'main'|'demo'} workspace
 */
export const visibilityClause = (workspace) =>
  workspace === 'demo' ? '(is_demo = 1 OR is_seed = 1)' : '(is_demo = 0 AND is_seed = 0)';

/** Pick a colour: the least used preset. @param {Db} db */
export function nextColor(db) {
  const rows = /** @type {any[]} */ (db.prepare('SELECT color, COUNT(*) AS n FROM users GROUP BY color').all());
  const used = new Map(rows.map((r) => [r.color, r.n]));
  return OWNER_COLORS.reduce((best, c) => ((used.get(c) ?? 0) < (used.get(best) ?? 0) ? c : best), OWNER_COLORS[0]);
}

/**
 * Insert a user row. Throws 409 username_taken / email_taken.
 * @param {Db} db
 * @param {{username: string, name: string, email?: string|null, role: string, status?: string, color?: string,
 *   isRoot?: boolean, isDemo?: boolean, isSeed?: boolean, passwordHash?: string|null, createdBy?: string|null, id?: string}} p
 */
export function insertUser(db, p) {
  assertUnique(db, p.username, p.email ?? null, null);
  const now = isoNow();
  const row = {
    id: p.id ?? newId(),
    username: p.username,
    email: p.email ?? null,
    name: p.name,
    role: p.role,
    is_root: p.isRoot ? 1 : 0,
    is_demo: p.isDemo ? 1 : 0,
    is_seed: p.isSeed ? 1 : 0,
    initials: null,
    status: p.status ?? 'invited',
    password_hash: p.passwordHash ?? null,
    webauthn_user_id: crypto.randomBytes(32).toString('base64url'),
    color: p.color ?? nextColor(db),
    created_at: now,
    created_by: p.createdBy ?? null,
    updated_at: now,
    updated_by: p.createdBy ?? null,
  };
  db.prepare(
    `INSERT INTO users (id, username, email, name, role, is_root, is_demo, is_seed, initials, status, password_hash,
       webauthn_user_id, color, created_at, created_by, updated_at, updated_by)
     VALUES (:id, :username, :email, :name, :role, :is_root, :is_demo, :is_seed, :initials, :status, :password_hash,
       :webauthn_user_id, :color, :created_at, :created_by, :updated_at, :updated_by)`,
  ).run(row);
  return loadUser(db, row.id);
}

/** @param {Db} db @param {string|undefined} username @param {string|null|undefined} email @param {string|null} exceptId */
export function assertUnique(db, username, email, exceptId) {
  if (username) {
    const u = /** @type {any} */ (db.prepare('SELECT id FROM users WHERE username = ?').get(username));
    if (u && u.id !== exceptId) throw conflict('username_taken', { fields: { username: 'username_taken' } });
  }
  if (email) {
    const u = /** @type {any} */ (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase()));
    if (u && u.id !== exceptId) throw conflict('email_taken', { fields: { email: 'email_taken' } });
  }
}

/**
 * Update profile fields with optimistic concurrency.
 * @param {Db} db @param {any} user current row @param {Record<string, any>} patch @param {number} version @param {string} actorId
 */
export function updateUser(db, user, patch, version, actorId) {
  if (user.version !== version) throw conflict('version_conflict', { current: user.version });
  assertUnique(db, patch.username, patch.email, user.id);
  const cols = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!cols.length) return user;
  const sets = cols.map((k) => `${k} = :${k}`).join(', ');
  const res = db
    .prepare(`UPDATE users SET ${sets}, version = version + 1, updated_at = :now, updated_by = :actor WHERE id = :id AND version = :version`)
    .run({ ...Object.fromEntries(cols.map((k) => [k, patch[k]])), now: isoNow(), actor: actorId, id: user.id, version });
  if (!res.changes) throw conflict('version_conflict', { current: loadUser(db, user.id)?.version });
  return loadUser(db, user.id);
}

/** @param {Db} db @param {string} id @param {string} hash */
export function setPasswordHash(db, id, hash) {
  db.prepare("UPDATE users SET password_hash = ?, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END, version = version + 1, updated_at = ? WHERE id = ?").run(
    hash,
    isoNow(),
    id,
  );
}

/**
 * Check a role change: the root admin can't be demoted; demo and seed accounts can't change.
 * @param {any} target @param {string} role
 */
export function assertRoleChangeAllowed(target, role) {
  if (target.is_root && role !== 'admin') throw forbidden('root_protected');
  if (target.is_demo) throw forbidden('demo_forbidden');
}

/** @param {Db} db @param {any} target @param {'active'|'disabled'} status @param {string} actorId */
export function setStatus(db, target, status, actorId) {
  if (target.is_root && status === 'disabled') throw forbidden('root_protected');
  if (target.id === actorId && status === 'disabled') throw forbidden('cannot_disable_self');
  if (target.status === 'invited' && status === 'active') throw new ApiError(400, 'user_not_activated');
  db.prepare('UPDATE users SET status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?').run(
    status,
    isoNow(),
    actorId,
    target.id,
  );
  if (status === 'disabled') revokeUserSessions(db, target.id);
  return loadUser(db, target.id);
}

/** @param {Db} db @param {string} id */
export function getOr404(db, id) {
  const u = loadUser(db, id);
  if (!u) throw notFound('user_not_found');
  return u;
}
