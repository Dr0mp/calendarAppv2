// Password policy (NIST SP 800-63B), shared by client and server. The server
// additionally checks the common-password list and the breach API.

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const APP_NAME = 'casa artis';

/** Length in Unicode code points. @param {string} s */
export const codePoints = (s) => [...s].length;

/**
 * Check the local rules. Returns an error code or null.
 * @param {string} password
 * @param {{username?: string|null, email?: string|null}} ctx
 */
export function passwordPolicyError(password, ctx = {}) {
  const len = codePoints(password);
  if (len < PASSWORD_MIN) return 'password_too_short';
  if (len > PASSWORD_MAX) return 'password_too_long';
  const lower = password.toLowerCase();
  const compact = lower.replace(/\s+/g, '');
  const forbidden = [ctx.username, ctx.email?.split('@')[0], APP_NAME, APP_NAME.replace(' ', '')]
    .filter((v) => typeof v === 'string' && v.length >= 3)
    .map((v) => /** @type {string} */ (v).toLowerCase());
  for (const f of forbidden) {
    if (lower.includes(f) || compact.includes(f.replace(/\s+/g, ''))) return 'password_contains_personal';
  }
  return null;
}

/**
 * A rough 0–4 strength score for the meter (length and variety based).
 * @param {string} password
 */
export function passwordStrength(password) {
  const len = codePoints(password);
  if (!len) return 0;
  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/\d/.test(password)) classes++;
  if (/[^A-Za-z0-9]/.test(password)) classes++;
  const unique = new Set(password).size;
  if (len < PASSWORD_MIN || unique < 5) return 1;
  let score = 2;
  if (len >= 16 || (len >= 12 && classes >= 3)) score = 3;
  if (len >= 20 || (len >= 16 && classes >= 3)) score = 4;
  return score;
}
