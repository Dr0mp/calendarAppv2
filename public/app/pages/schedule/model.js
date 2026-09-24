// Form state for the scheduling form, and conversion to/from the API shape.
import { addDays, fromMinutes, toMinutes } from '../../time.js';

/**
 * @typedef {{date: string, start: string, end: string}} Session
 * @typedef {{room_id: string, check_in: string, check_out: string, guests: number, guest_names: string}} Booking
 * @typedef {{
 *   type: 'event'|'blocked'|'room_only', title: string, description: string, space_id: string,
 *   mode: 'one'|'sameday'|'multiday', sessions: Session[], needsRooms: boolean, room_bookings: Booking[],
 *   free: boolean, price: string, currency: 'RON'|'EUR', price_note: string, enroll_url: string,
 *   cover_url: string, cover_media_id: string|null, allow_overlap: boolean, recurrence: any
 * }} FormState
 */

/** @param {{date: string, time: string}} start @param {Partial<FormState>} [over] @returns {FormState} */
export function emptyForm(start, over = {}) {
  const s = toMinutes(start.time);
  const end = Math.min(s + 120, 24 * 60);
  return {
    type: 'event',
    title: '',
    description: '',
    space_id: '',
    mode: 'one',
    sessions: [{ date: start.date, start: start.time, end: fromMinutes(end) }],
    needsRooms: false,
    room_bookings: [],
    free: false,
    price: '',
    currency: 'RON',
    price_note: '',
    enroll_url: '',
    cover_url: '',
    cover_media_id: null,
    allow_overlap: false,
    recurrence: null,
    ...over,
  };
}

/** Pick the session mode that fits existing sessions. @param {Session[]} sessions */
export function modeFor(sessions) {
  if (sessions.length <= 1) return 'one';
  return new Set(sessions.map((s) => s.date)).size === 1 ? 'sameday' : 'multiday';
}

/** @param {any} e API entry @returns {FormState} */
export function fromEntry(e) {
  return {
    type: e.type,
    title: e.title ?? '',
    description: e.description ?? '',
    space_id: e.space_id ?? '',
    mode: modeFor(e.sessions),
    sessions: e.sessions.length ? e.sessions.map((/** @type {Session} */ s) => ({ ...s })) : [],
    needsRooms: e.room_bookings.length > 0,
    room_bookings: e.room_bookings.map((/** @type {any} */ b) => ({
      room_id: b.room_id,
      check_in: b.check_in,
      check_out: b.check_out,
      guests: b.guests ?? 1,
      guest_names: b.guest_names ?? '',
    })),
    free: e.type === 'event' && e.price_cents == null,
    price: e.price_cents == null ? '' : String(e.price_cents / 100).replace('.', ','),
    currency: e.currency ?? 'RON',
    price_note: e.price_note ?? '',
    enroll_url: e.enroll_url ?? '',
    cover_url: e.cover_url ?? '',
    cover_media_id: e.cover_media_id ?? null,
    allow_overlap: !!e.allow_overlap,
    recurrence: null,
  };
}

/** Parse "75", "75,50", "1.250,00" into cents. @param {string} s */
export function parsePrice(s) {
  const clean = s.trim().replace(/\s/g, '');
  if (!clean) return null;
  const normalised = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const n = Number(normalised);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

/**
 * The API payload. Sections that don't apply to the type are dropped.
 * @param {FormState} f @param {{staff: boolean}} ctx
 */
export function toPayload(f, ctx) {
  const isEvent = f.type === 'event';
  const cents = isEvent && !f.free ? parsePrice(f.price) : null;
  /** @type {Record<string, any>} */
  const out = {
    type: f.type,
    title: f.title.trim(),
    description: f.description.trim() || null,
    space_id: f.type === 'room_only' ? null : f.space_id || null,
    sessions: f.type === 'room_only' ? [] : f.sessions,
  };
  if (isEvent) {
    Object.assign(out, {
      price_cents: cents === null || Number.isNaN(cents) ? (f.free ? null : cents) : cents,
      currency: f.free ? null : f.currency,
      price_note: f.price_note.trim() || null,
      enroll_url: f.enroll_url.trim(),
      cover_media_id: f.cover_media_id,
      cover_url: f.cover_media_id ? null : f.cover_url.trim() || null,
    });
  }
  if (ctx.staff && (f.type === 'room_only' || f.needsRooms)) {
    out.room_bookings = f.room_bookings.map((b) => ({
      room_id: b.room_id,
      check_in: b.check_in,
      check_out: b.check_out,
      guests: Number(b.guests) || 1,
      guest_names: b.guest_names.trim() || null,
    }));
  } else if (ctx.staff) {
    out.room_bookings = [];
  }
  if (f.allow_overlap) out.allow_overlap = true;
  return out;
}

/** Shift every session so the first one lands on `date`. @param {Session[]} sessions @param {string} date */
export function shiftSessions(sessions, date) {
  if (!sessions.length) return sessions;
  const first = [...sessions].sort((a, b) => a.date.localeCompare(b.date))[0].date;
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
  return sessions.map((s) => ({ ...s, date: addDays(s.date, diff) }));
}

/** Sort multi-day rows by date then time. @param {Session[]} s */
export const sortSessions = (s) => [...s].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

/** Duration of a session in minutes. @param {Session} s */
export const minutesOf = (s) => toMinutes(s.end) - toMinutes(s.start);
