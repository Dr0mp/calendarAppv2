import { isoNow, HOUR, MIN } from '../util.js';
import { randomToken, sha256 } from './crypto.js';

/** @typedef {import('../db/open.js').Db} Db */

export const TOKEN_TTL = { invite: 72 * HOUR, reset: 60 * MIN };

/**
 * Create a single-use token. Earlier unused tokens of the same purpose for the
 * user are invalidated. Only the SHA-256 is stored.
 * @param {Db} db @param {string} userId @param {'invite'|'reset'} purpose
 */
export function createToken(db, userId, purpose) {
  const raw = randomToken(32);
  db.tx(() => {
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL').run(userId, purpose);
    db.prepare('INSERT INTO auth_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
      sha256(raw),
      userId,
      purpose,
      isoNow(),
      isoNow(Date.now() + TOKEN_TTL[purpose]),
    );
  });
  return raw;
}

/** Check a token without consuming it. @param {Db} db @param {string} raw */
export function peekToken(db, raw) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) return null;
  const row = /** @type {any} */ (
    db.prepare('SELECT user_id, purpose, expires_at, used_at FROM auth_tokens WHERE token_hash = ?').get(sha256(raw))
  );
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) return null;
  return { userId: row.user_id, purpose: /** @type {'invite'|'reset'} */ (row.purpose) };
}

/**
 * Consume a token atomically: exactly one caller can succeed.
 * @param {Db} db @param {string} raw
 */
export function consumeToken(db, raw) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) return null;
  const now = isoNow();
  const row = /** @type {any} */ (
    db
      .prepare('UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id, purpose')
      .get(now, sha256(raw), now)
  );
  return row ? { userId: row.user_id, purpose: /** @type {'invite'|'reset'} */ (row.purpose) } : null;
}

/** @param {Db} db */
export const pruneTokens = (db) =>
  db.prepare('DELETE FROM auth_tokens WHERE expires_at <= ? OR used_at IS NOT NULL').run(isoNow(Date.now() - 24 * HOUR));
