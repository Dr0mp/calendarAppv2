// Pure parsers for v1 data (§14). No I/O; unit-tested.
import { addDays, fromMinutes, toMinutes } from '../../shared/rules/time.js';

// ---- Colours ---------------------------------------------------------------

/** OKLCH hues of the 12 owner presets (tokens.css). */
const OWNER_HUES = [25, 50, 80, 125, 150, 175, 205, 235, 265, 295, 330, 358];

/** sRGB hex → OKLCH {l, c, h}. @param {string} hex */
export function hexToOklch(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = (/** @type {number} */ v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/**
 * The owner preset nearest to a v1 hex colour, by hue. Greys (no chroma)
 * and unparseable values get the neutral-ish teal `owner-7`.
 * @param {string|null|undefined} hex
 */
export function nearestOwnerColor(hex) {
  const o = hex ? hexToOklch(hex) : null;
  if (!o || o.c < 0.03) return 'owner-7';
  let best = 0;
  let bestD = Infinity;
  OWNER_HUES.forEach((h, i) => {
    const d = Math.min(Math.abs(o.h - h), 360 - Math.abs(o.h - h));
    if (d < bestD) (bestD = d), (best = i);
  });
  return `owner-${best + 1}`;
}

// ---- Numbers in text -------------------------------------------------------

/** "80 persoane" → 80; null when there is no number. @param {unknown} v */
export function parseCapacity(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
  const m = /(\d+)/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
}

/** "9:16" (or "4:5 or 1:1") → [9, 16]. @param {unknown} v */
export function parseRatio(v) {
  const m = /(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)/i.exec(String(v ?? ''));
  if (!m) return null;
  // Keep integers (e.g. 1.91:1 → 191:100).
  const decimals = Math.max(...[m[1], m[2]].map((x) => x.split('.')[1]?.length ?? 0));
  const k = 10 ** decimals;
  return /** @type {[number, number]} */ ([Math.round(Number(m[1]) * k), Math.round(Number(m[2]) * k)]);
}

const UNIT_S = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600 };

/**
 * The first duration in free text, in seconds: "10 mins (sweet spot 15-60s)"
 * → 600; "90s / up to 15 mins" → 90. Null when none.
 * @param {unknown} v
 */
export function parseDurationSeconds(v) {
  const m = /(\d+(?:[.,]\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i.exec(String(v ?? ''));
  if (!m) return null;
  return Math.round(Number(m[1].replace(',', '.')) * UNIT_S[/** @type {'s'} */ (m[2].toLowerCase())]);
}

/**
 * The strictest file size in MB: "287.6 MB (iOS) / 72 MB (Android)" → 72;
 * "4 GB" → 4096.
 * @param {unknown} v
 */
export function parseFileSizeMb(v) {
  const sizes = [...String(v ?? '').matchAll(/(\d+(?:[.,]\d+)?)\s*(KB|MB|GB)\b/gi)].map((m) => {
    const n = Number(m[1].replace(',', '.'));
    const unit = m[2].toUpperCase();
    return unit === 'GB' ? n * 1024 : unit === 'KB' ? n / 1024 : n;
  });
  if (!sizes.length) return null;
  return Math.max(1, Math.floor(Math.min(...sizes)));
}

/** The first integer in text: "80-100 characters" → 80. @param {unknown} v */
export function firstInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const m = /(\d+)/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
}

// ---- Prices ----------------------------------------------------------------

/**
 * v1's free-text price. Numbers (ignoring $, €, lei, RON and spaces) become
 * cents with the currency from the symbol (EUR for € / EUR, and for $,
 * which v2 does not support, with a warning; RON otherwise);
 * "Free…" / "Gratuit…" is free (a parenthetical becomes the note);
 * anything else goes to the note.
 * @param {unknown} price @param {unknown} [currency]
 * @returns {{price_cents: number|null, currency: 'RON'|'EUR'|null, price_note: string|null, warning: string|null}}
 */
export function parsePrice(price, currency) {
  const text = String(price ?? '').trim();
  if (!text) return { price_cents: null, currency: null, price_note: null, warning: null };
  const free = /^(free|gratuit|gratis)\b/i.exec(text);
  if (free) {
    const note = /\(([^)]+)\)/.exec(text)?.[1]?.trim() ?? null;
    return { price_cents: null, currency: null, price_note: note, warning: null };
  }
  const stripped = text.replace(/\$|€|\blei\b|\bRON\b|\bEUR\b|\s/gi, '');
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(stripped);
  if (m) {
    const cents = Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0);
    const cur = /€|\$|\bEUR\b/i.test(`${text} ${currency ?? ''}`) ? 'EUR' : 'RON';
    const warning = /\$/.test(text) ? 'currency_assumed' : null;
    return { price_cents: cents, currency: cur, price_note: null, warning };
  }
  return { price_cents: null, currency: null, price_note: text.slice(0, 120), warning: 'price_unparsed' };
}

// ---- Sessions and bookings -------------------------------------------------

/** Every date from a to b inclusive. @param {string} a @param {string} b */
export function dateRange(a, b) {
  /** @type {string[]} */ const out = [];
  for (let d = a; d <= b && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Sessions for a v1 event: one per day at `hour` for `durationHours`, split
 * at midnight; or, with `scheduledHours`, one 60-minute session per hour.
 * @param {any} e
 * @returns {{date: string, start: string, end: string}[]}
 */
export function sessionsFromV1(e) {
  if ((e.entryType ?? 'event') === 'room_only') return [];
  const start = e.startDate ?? e.date;
  if (!start) return [];
  const days = dateRange(start, e.endDate && e.endDate >= start ? e.endDate : start);
  /** @type {{date: string, start: string, end: string}[]} */ const out = [];
  const hours = Array.isArray(e.scheduledHours) ? e.scheduledHours.filter((/** @type {any} */ h) => /^\d{1,2}:\d{2}$/.test(h)) : [];
  if (hours.length) {
    for (const d of days) {
      for (const h of [...new Set(hours)].sort()) {
        const s = toMinutes(h.padStart(5, '0'));
        out.push({ date: d, start: fromMinutes(s), end: fromMinutes(Math.min(s + 60, 1440)) });
      }
    }
    return out;
  }
  const hour = /^\d{1,2}:\d{2}$/.test(e.hour ?? e.time ?? '') ? (e.hour ?? e.time).padStart(5, '0') : '18:00';
  const minutes = Math.max(15, Math.round((Number(e.durationHours) || 2) * 60));
  for (const d of days) {
    const s = toMinutes(hour);
    const end = s + minutes;
    if (end <= 1440) out.push({ date: d, start: fromMinutes(s), end: fromMinutes(end) });
    else {
      out.push({ date: d, start: fromMinutes(s), end: '24:00' });
      out.push({ date: addDays(d, 1), start: '00:00', end: fromMinutes(Math.min(end - 1440, 1440)) });
    }
  }
  // Consecutive days crossing midnight can overlap the next day's own session; keep them ordered.
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

/**
 * Room bookings: v1 dates are inclusive, so check-out is the day after.
 * @param {any} e
 * @returns {{roomId: string, check_in: string, check_out: string}[]}
 */
export function bookingsFromV1(e) {
  const list = Array.isArray(e.roomBookings) && e.roomBookings.length
    ? e.roomBookings
    : e.roomId
      ? [{ roomId: e.roomId, startDate: e.startDate, endDate: e.endDate }]
      : [];
  return list
    .filter((/** @type {any} */ b) => b && b.roomId && b.startDate)
    .map((/** @type {any} */ b) => ({ roomId: b.roomId, check_in: b.startDate, check_out: addDays(b.endDate && b.endDate >= b.startDate ? b.endDate : b.startDate, 1) }));
}

/** v1 username → a valid v2 username (a-z 0-9 . _ -, 3–32). @param {string} u */
export function cleanUsername(u) {
  let s = String(u ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 32);
  while (s.length < 3) s += '0';
  return s;
}
