import { z } from 'zod';
import { dateStr, endTimeStr, httpsUrl, id, optText, text, timeStr } from './common.js';
import { internalOverlaps } from '../rules/conflicts.js';
import { toMinutes, addDays } from '../rules/time.js';

export const ENTRY_TYPES = /** @type {const} */ (['event', 'blocked', 'room_only']);
export const MAX_SESSIONS = 60;

export const SessionInput = z.strictObject({
  date: dateStr,
  start: timeStr,
  end: endTimeStr,
});

export const BookingInput = z.strictObject({
  id: z.string().optional(),
  room_id: id,
  check_in: dateStr,
  check_out: dateStr,
  guests: z.number().int('invalid_type').min(1, 'too_small').max(50, 'too_big'),
  guest_names: optText(500),
});

const base = {
  type: z.enum(ENTRY_TYPES),
  title: text(120),
  description: optText(5000),
  space_id: id.nullish(),
  sessions: z.array(SessionInput).max(MAX_SESSIONS, 'too_many_sessions'),
  room_bookings: z.array(BookingInput).max(20, 'too_big').optional(),
  price_cents: z.number().int('invalid_type').min(0, 'too_small').max(100_000_000, 'too_big').nullish(),
  currency: z.enum(['RON', 'EUR']).nullish(),
  price_note: optText(120),
  enroll_url: z.union([httpsUrl, z.literal(''), z.null()]).optional(),
  cover_media_id: id.nullish(),
  cover_url: z.union([httpsUrl, z.literal(''), z.null()]).optional(),
  allow_overlap: z.boolean().optional(),
};

/**
 * Per-type rules shared by client and server.
 * @param {any} e
 * @param {z.RefinementCtx} ctx
 */
export function refineEntry(e, ctx) {
  /** @param {(string|number)[]} path @param {string} message */
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });

  if (e.type === 'room_only') {
    if (e.sessions.length) issue(['sessions'], 'no_sessions_for_room_only');
    if (!e.room_bookings?.length) issue(['room_bookings'], 'room_booking_required');
  } else {
    if (!e.sessions.length) issue(['sessions'], 'session_required');
    e.sessions.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
      if (toMinutes(s.end) <= toMinutes(s.start)) issue(['sessions', i, 'end'], 'end_before_start');
    });
    for (const [, j] of internalOverlaps(e.sessions)) issue(['sessions', j, 'start'], 'sessions_overlap');
  }

  if (e.type === 'event') {
    if (!e.space_id) issue(['space_id'], 'required');
    if (!e.enroll_url) issue(['enroll_url'], 'required');
    if (!e.cover_media_id && !e.cover_url) issue(['cover'], 'cover_required');
    if (e.price_cents != null && !e.currency) issue(['currency'], 'required');
  }

  (e.room_bookings ?? []).forEach((/** @type {any} */ b, /** @type {number} */ i) => {
    if (b.check_out <= b.check_in) issue(['room_bookings', i, 'check_out'], 'checkout_before_checkin');
  });
}

export const EntryInput = z.strictObject(base).superRefine(refineEntry);

/**
 * Normalise an input: drop fields that don't apply to the type.
 * @param {z.infer<typeof EntryInput>} e
 */
export function normaliseEntry(e) {
  const isEvent = e.type === 'event';
  const out = {
    type: e.type,
    title: e.title,
    description: e.description ?? null,
    space_id: e.type === 'room_only' ? null : e.space_id ?? null,
    sessions: e.type === 'room_only' ? [] : [...e.sessions].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)),
    room_bookings: e.room_bookings,
    price_cents: isEvent ? e.price_cents ?? null : null,
    currency: isEvent && e.price_cents != null ? e.currency ?? null : null,
    price_note: isEvent ? e.price_note ?? null : null,
    enroll_url: isEvent ? e.enroll_url || null : null,
    cover_media_id: isEvent ? e.cover_media_id ?? null : null,
    cover_url: isEvent && !e.cover_media_id ? e.cover_url || null : null,
    allow_overlap: !!e.allow_overlap,
  };
  return out;
}

/**
 * The date span of an entry: sessions and room bookings (check-out day excluded).
 * @param {{sessions: {date: string}[], room_bookings?: {check_in: string, check_out: string}[]}} e
 */
export function entrySpan(e) {
  const dates = [
    ...e.sessions.map((s) => s.date),
    ...(e.room_bookings ?? []).flatMap((b) => [b.check_in, addDays(b.check_out, -1)]),
  ].sort();
  return { first: dates[0] ?? null, last: dates[dates.length - 1] ?? null };
}

export const ReassignInput = z.strictObject({ ownerId: id, scope: z.enum(['one', 'following', 'all']).optional() });

export const RoomBookingsInput = z.strictObject({ room_bookings: z.array(BookingInput).max(20) });

export const AvailabilityInput = z.strictObject({
  type: z.enum(ENTRY_TYPES).default('event'),
  spaceId: id.nullish(),
  sessions: z.array(SessionInput).max(MAX_SESSIONS),
  rooms: z.array(BookingInput.partial({ guests: true })).max(20).optional(),
  excludeEntryId: z.string().nullish(),
  /** Extra dates whose busy intervals the strip needs. */
  dates: z.array(dateStr).max(62).optional(),
});
