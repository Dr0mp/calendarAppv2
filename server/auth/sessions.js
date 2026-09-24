import { newId, isoNow, DAY, HOUR, MIN } from '../util.js';
import { randomToken, sha256 } from './crypto.js';

/** @typedef {import('../db/open.js').Db} Db */

/** @param {{secureCookies: boolean}} config */
export const cookieName = (config) => (config.secureCookies ? '__Host-sid' : 'sid');

/**
 * Create a server-side session. Only the SHA-256 of the cookie value is stored.
 * @param {Db} db
 * @param {{userId: string, workspace: 'main'|'demo', userAgent?: string|null, ip?: string|null}} p
 * @param {{sessionTtlDays: number}} config
 */
export function createSession(db, p, config) {
  const value = randomToken(32);
  const now = isoNow();
  const row = {
    id: newId(),
    id_hash: sha256(value),
    user_id: p.userId,
    workspace: p.workspace,
    csrf_token: randomToken(32),
    created_at: now,
    last_seen_at: now,
    expires_at: isoNow(Date.now() + config.sessionTtlDays * DAY),
    user_agent: (p.userAgent ?? '').slice(0, 300) || null,
    ip: p.ip ?? null,
  };
  db.prepare(
    `INSERT INTO sessions (id, id_hash, user_id, workspace, csrf_token, created_at, last_seen_at, expires_at, user_agent, ip)
     VALUES (:id, :id_hash, :user_id, :workspace, :csrf_token, :created_at, :last_seen_at, :expires_at, :user_agent, :ip)`,
  ).run(row);
  return { value, session: row };
}

/**
 * Look up a session by cookie value, enforcing absolute and idle expiry.
 * Sliding expiry: last_seen_at is refreshed at most once a minute.
 * @param {Db} db
 * @param {string} value
 * @param {{sessionIdleHours: number}} config
 */
export function loadSession(db, value, config) {
  if (!value || value.length > 100) return null;
  const idHash = sha256(value);
  const s = /** @type {any} */ (db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(idHash));
  if (!s) return null;
  const now = Date.now();
  if (Date.parse(s.expires_at) <= now || Date.parse(s.last_seen_at) + config.sessionIdleHours * HOUR <= now) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
    return null;
  }
  if (Date.parse(s.last_seen_at) + MIN < now) {
    s.last_seen_at = isoNow(now);
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(s.last_seen_at, idHash);
  }
  return s;
}

/** @param {Db} db @param {string} idHash */
export const deleteSession = (db, idHash) => db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);

/** Revoke every session of a user (optionally keeping one). @param {Db} db @param {string} userId @param {string} [exceptHash] */
export function revokeUserSessions(db, userId, exceptHash) {
  if (exceptHash) {
    return db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?').run(userId, exceptHash).changes;
  }
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
}

/** @param {Db} db @param {string} userId */
export function listSessions(db, userId) {
  return db
    .prepare('SELECT id, id_hash, workspace, created_at, last_seen_at, expires_at, user_agent, ip FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC')
    .all(userId);
}

/** @param {Db} db @param {{sessionIdleHours:number}} config */
export function pruneSessions(db, config) {
  const now = Date.now();
  return db
    .prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?')
    .run(isoNow(now), isoNow(now - config.sessionIdleHours * HOUR)).changes;
}
