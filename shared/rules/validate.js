// Plain validators with no dependencies, shared by the Zod schemas and by
// browser code that must not pull in Zod on the first paint.

export const OWNER_COLORS = Array.from(
  { length: 12 },
  (_, i) => `owner-${i + 1}`,
);

/** A real calendar date, YYYY-MM-DD. @param {string} s */
export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

/** https:// only; javascript:, data: and everything else are rejected. @param {string} s */
export function isHttpsUrl(s) {
  if (typeof s !== "string" || s.length > 2000) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}

/** A UNC network path such as \\server\share\folder. */
export const UNC_RE = /^\\\\[^\\/:*?"<>|]+\\[^/:*?"<>|]+(\\[^/:*?"<>|]*)*$/;

/** An http(s) URL or a UNC path. @param {string} s */
export function isShareLink(s) {
  if (UNC_RE.test(s)) return true;
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
}

export const ROOM_TYPES = ["Matrimonială", "Twin", "Single", "Suită"];
