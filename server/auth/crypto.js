import crypto from 'node:crypto';

/** 32 random bytes, base64url-encoded. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Hex SHA-256 of a string. @param {string} s */
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Constant-time string comparison. @param {string} a @param {string} b */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
