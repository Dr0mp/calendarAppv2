import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';
import { passwordPolicyError } from '../../shared/rules/password.js';

export const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };
const LEGACY_PREFIX = 'legacy-bcrypt:';

let common = /** @type {Set<string>|null} */ (null);
function commonPasswords() {
  if (!common) {
    const text = fs.readFileSync(path.join(import.meta.dirname, 'common-passwords.txt'), 'utf8');
    common = new Set(text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean));
  }
  return common;
}

/** @param {string} password */
export const hashPassword = (password) => hash(password, ARGON);

let dummyHash = '';
/** A real argon2 hash to verify against when the user does not exist (equal timing). */
export async function getDummyHash() {
  if (!dummyHash) dummyHash = await hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

/** @param {string} phc */
export function needsRehash(phc) {
  if (phc.startsWith(LEGACY_PREFIX)) return true;
  const m = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(phc);
  if (!m) return true;
  return Number(m[1]) < ARGON.memoryCost || Number(m[2]) < ARGON.timeCost || Number(m[3]) !== ARGON.parallelism;
}

/**
 * Verify a password against a stored hash (argon2id PHC, or a migrated v1 bcrypt hash).
 * @param {string|null} stored
 * @param {string} password
 */
export async function verifyPassword(stored, password) {
  if (!stored) {
    await verify(await getDummyHash(), password).catch(() => false);
    return { ok: false, rehash: false };
  }
  if (stored.startsWith(LEGACY_PREFIX)) {
    const ok = await bcrypt.compare(password, stored.slice(LEGACY_PREFIX.length));
    return { ok, rehash: ok };
  }
  const ok = await verify(stored, password).catch(() => false);
  return { ok, rehash: ok && needsRehash(stored) };
}

/**
 * Query Have I Been Pwned (k-anonymity: only 5 hex chars of the SHA-1 leave the server).
 * Fails open when the service is unreachable.
 * @param {string} password
 */
export async function isBreached(password) {
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'casa-artis-calendar' },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const body = await res.text();
    const suffix = sha1.slice(5);
    return body.split('\n').some((line) => {
      const [s, count] = line.trim().split(':');
      return s === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}

/**
 * Full server-side policy check. Returns an error code or null.
 * @param {string} password
 * @param {{username?: string|null, email?: string|null}} ctx
 * @param {{hibp: boolean}} opts
 */
export async function checkPassword(password, ctx, opts) {
  const local = passwordPolicyError(password, ctx);
  if (local) return local;
  if (commonPasswords().has(password.toLowerCase())) return 'password_common';
  if (opts.hibp && (await isBreached(password))) return 'password_breached';
  return null;
}

/** Log a warning when one hash takes longer than 500 ms. @param {import('pino').Logger} log */
export async function benchmarkHashing(log) {
  const t = performance.now();
  await hashPassword('benchmark-password-value');
  const ms = Math.round(performance.now() - t);
  if (ms > 500) log.warn({ ms }, 'argon2id hashing is slow on this machine');
  else log.debug({ ms }, 'argon2id benchmark');
}
