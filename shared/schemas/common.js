// Building blocks for the Zod schemas shared by the browser and the server.
// Messages are stable snake_case codes; the client translates them.
import { z } from 'zod';

export const OWNER_COLORS = Array.from({ length: 12 }, (_, i) => `owner-${i + 1}`);

export const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid_id');

/** A real calendar date, YYYY-MM-DD. @param {string} s */
export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

export const dateStr = z.string().refine(isValidDate, 'invalid_date');
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'invalid_time');
export const endTimeStr = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'invalid_time');

/** https:// only; javascript:, data: and everything else are rejected. @param {string} s */
export function isHttpsUrl(s) {
  if (typeof s !== 'string' || s.length > 2000) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}

export const httpsUrl = z.string().trim().max(2000).refine(isHttpsUrl, 'invalid_https_url');

/** A UNC network path such as \\server\share\folder. */
export const UNC_RE = /^\\\\[^\\/:*?"<>|]+\\[^/:*?"<>|]+(\\[^/:*?"<>|]*)*$/;

/** An http(s) URL or a UNC path. @param {string} s */
export function isShareLink(s) {
  if (UNC_RE.test(s)) return true;
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname;
  } catch {
    return false;
  }
}

export const shareLink = z.string().trim().max(2000).refine(isShareLink, 'invalid_share_link');
export const ownerColor = z.enum(OWNER_COLORS, 'invalid_color');
export const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'invalid_color');
export const locale = z.enum(['ro', 'en']);
export const theme = z.enum(['system', 'light', 'dark']);

/** Required trimmed text with a max length. @param {number} max @param {number} [min] */
export const text = (max, min = 1) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? 'required' : 'too_short')
    .max(max, 'too_long');

/** Optional text: empty string becomes null. @param {number} max */
export const optText = (max) =>
  z
    .string()
    .trim()
    .max(max, 'too_long')
    .nullish()
    .transform((v) => (v ? v : null));

export const email = z
  .string()
  .trim()
  .max(254, 'too_long')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'invalid_email')
  .transform((v) => v.toLowerCase());
