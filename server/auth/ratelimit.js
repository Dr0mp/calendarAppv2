import { isoNow, MIN } from '../util.js';

/**
 * SQLite-backed fixed-window counters (table auth.rate_limits).
 * @typedef {import('../db/open.js').Db} Db
 */

/**
 * Count one hit against `key`. Returns whether it is allowed, and when to retry.
 * @param {Db} db
 * @param {string} key
 * @param {number} limit
 * @param {number} windowMs
 */
export function hit(db, key, limit, windowMs) {
  const now = Date.now();
  const row = /** @type {any} */ (db.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').get(key));
  if (!row || Date.parse(row.window_start) + windowMs <= now) {
    db.prepare(
      'INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start, blocked_until = NULL',
    ).run(key, isoNow(now));
    return { ok: true, retryAfter: 0 };
  }
  if (row.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((Date.parse(row.window_start) + windowMs - now) / 1000) };
  }
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key);
  return { ok: true, retryAfter: 0 };
}

/**
 * Check a counter without counting a hit.
 * @param {Db} db @param {string} key @param {number} limit @param {number} windowMs
 */
export function peek(db, key, limit, windowMs) {
  const now = Date.now();
  const row = /** @type {any} */ (db.prepare('SELECT count, window_start, blocked_until FROM rate_limits WHERE key = ?').get(key));
  if (!row) return { ok: true, retryAfter: 0 };
  if (row.blocked_until && Date.parse(row.blocked_until) > now) {
    return { ok: false, retryAfter: Math.ceil((Date.parse(row.blocked_until) - now) / 1000) };
  }
  if (Date.parse(row.window_start) + windowMs <= now) return { ok: true, retryAfter: 0 };
  if (limit && row.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((Date.parse(row.window_start) + windowMs - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

const LOGIN_WINDOW = 15 * MIN;
const LOGIN_FREE_FAILURES = 5;
const LOGIN_BASE_DELAY = 30_000;
const LOGIN_MAX_DELAY = 15 * MIN;
const IP_LIMIT = 30;

/**
 * Login defences: an increasing delay per username+IP (after 5 failures within
 * 15 min wait 30 s, doubling up to 15 min) plus 30 failures per IP per 15 min.
 * Only failed attempts count.
 * @param {Db} db @param {string} login @param {string} ip
 */
export function loginAllowed(db, login, ip) {
  const a = peek(db, `login:${login.toLowerCase()}|${ip}`, 0, LOGIN_WINDOW);
  if (!a.ok) return a;
  return peek(db, `login-ip:${ip}`, IP_LIMIT, LOGIN_WINDOW);
}

/** @param {Db} db @param {string} login @param {string} ip */
export function loginFailed(db, login, ip) {
  const key = `login:${login.toLowerCase()}|${ip}`;
  const now = Date.now();
  db.tx(() => {
    const row = /** @type {any} */ (db.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').get(key));
    let count = 1;
    let start = isoNow(now);
    if (row && Date.parse(row.window_start) + LOGIN_WINDOW > now) {
      count = row.count + 1;
      start = row.window_start;
    }
    let blocked = null;
    if (count >= LOGIN_FREE_FAILURES) {
      const delay = Math.min(LOGIN_BASE_DELAY * 2 ** (count - LOGIN_FREE_FAILURES), LOGIN_MAX_DELAY);
      blocked = isoNow(now + delay);
    }
    db.prepare(
      `INSERT INTO rate_limits (key, count, window_start, blocked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start, blocked_until = excluded.blocked_until`,
    ).run(key, count, start, blocked);
    hit(db, `login-ip:${ip}`, Number.MAX_SAFE_INTEGER, LOGIN_WINDOW);
  });
}

/** @param {Db} db @param {string} login @param {string} ip */
export function loginSucceeded(db, login, ip) {
  db.prepare('DELETE FROM rate_limits WHERE key = ?').run(`login:${login.toLowerCase()}|${ip}`);
}

/** Drop stale counters. @param {Db} db */
export function pruneRateLimits(db) {
  db.prepare("DELETE FROM rate_limits WHERE window_start < ? AND (blocked_until IS NULL OR blocked_until < ?)").run(
    isoNow(Date.now() - 24 * 60 * MIN),
    isoNow(),
  );
}
