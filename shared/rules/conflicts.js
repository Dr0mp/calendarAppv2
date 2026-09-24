// Conflict detection shared by the browser (live feedback) and the server
// (enforced inside the write transaction). Pure functions, no I/O.
//
// Busy time (§5.4): a space is busy when any `event` or `blocked` entry in
// that space has a session covering the time. A blocked slot with no space
// makes every space busy. Room bookings never make a space busy.
//
// Space rules:            new entry   overlaps              result
//                         event       event, same space     blocked (admin override)
//                         any         blocked slot          blocked (admin override)
//                         blocked     event                 blocked (admin override)
// Room rule: [check_in, check_out) ranges on one room may not overlap. No override.

import { toMinutes } from './time.js';

/**
 * @typedef {{date: string, start: string, end: string}} Session
 * @typedef {{room_id: string, check_in: string, check_out: string, id?: string}} Booking
 * @typedef {{id?: string, type: 'event'|'blocked'|'room_only', title?: string|null, space_id?: string|null,
 *   owner_id?: string, owner_name?: string, sessions: Session[], room_bookings?: Booking[]}} EntryLike
 * @typedef {{entry: {id: string, title: string|null, type: string, owner_id?: string, owner_name?: string, space_id?: string|null},
 *   date: string, start: string, end: string, kind: 'event'|'blocked', session: Session}} SpaceConflict
 * @typedef {{entry: {id: string|null, title: string|null, type?: string, owner_name?: string}, room_id: string,
 *   check_in: string, check_out: string, booking: Booking}} RoomConflict
 */

/** Minutes of a session (end "24:00" = 1440). @param {Session} s */
export const span = (s) => [toMinutes(s.start), toMinutes(s.end)];

/** Do two sessions overlap (same date, half-open intervals)? @param {Session} a @param {Session} b */
export function sessionsOverlap(a, b) {
  if (a.date !== b.date) return false;
  const [a1, a2] = span(a);
  const [b1, b2] = span(b);
  return a1 < b2 && b1 < a2;
}

/** Do two date ranges [in, out) overlap? Check-out day is free for a new check-in. */
export function rangesOverlap(aIn, aOut, bIn, bOut) {
  return aIn < bOut && bIn < aOut;
}

/**
 * Do the spaces of two entries interact? Null space on a blocked slot = whole venue.
 * @param {string|null|undefined} a @param {string|null|undefined} b
 */
function spacesMeet(a, b) {
  return !a || !b || a === b;
}

/**
 * Would `candidate` conflict with `other` on space time? Returns the kind of
 * the blocking entry, or null.
 * @param {EntryLike} candidate @param {EntryLike} other
 * @returns {'event'|'blocked'|null}
 */
export function spaceRule(candidate, other) {
  if (candidate.type === 'room_only' || other.type === 'room_only') return null;
  if (candidate.type === 'event' && other.type === 'event') {
    return candidate.space_id && candidate.space_id === other.space_id ? 'event' : null;
  }
  // At least one side is a blocked slot.
  return spacesMeet(candidate.space_id, other.space_id) ? other.type : null;
}

/**
 * Space conflicts of `candidate` against existing entries.
 * @param {EntryLike} candidate
 * @param {EntryLike[]} existing
 * @returns {SpaceConflict[]}
 */
export function findSpaceConflicts(candidate, existing) {
  /** @type {SpaceConflict[]} */
  const out = [];
  for (const other of existing) {
    if (candidate.id && other.id === candidate.id) continue;
    const kind = spaceRule(candidate, other);
    if (!kind) continue;
    for (const s of candidate.sessions) {
      for (const o of other.sessions) {
        if (sessionsOverlap(s, o)) {
          out.push({
            entry: { id: /** @type {string} */ (other.id), title: other.title ?? null, type: other.type, owner_id: other.owner_id, owner_name: other.owner_name, space_id: other.space_id ?? null },
            date: o.date,
            start: o.start,
            end: o.end,
            kind,
            session: s,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Room conflicts: against existing bookings, and between rows of the same form.
 * @param {Booking[]} bookings the candidate's rows
 * @param {EntryLike[]} existing
 * @param {string} [selfId] entry id being edited (its own bookings are ignored)
 * @returns {RoomConflict[]}
 */
export function findRoomConflicts(bookings, existing, selfId) {
  /** @type {RoomConflict[]} */
  const out = [];
  bookings.forEach((b, i) => {
    for (const other of existing) {
      if (selfId && other.id === selfId) continue;
      for (const o of other.room_bookings ?? []) {
        if (o.room_id === b.room_id && rangesOverlap(b.check_in, b.check_out, o.check_in, o.check_out)) {
          out.push({
            entry: { id: other.id ?? null, title: other.title ?? null, type: other.type, owner_name: other.owner_name },
            room_id: o.room_id,
            check_in: o.check_in,
            check_out: o.check_out,
            booking: b,
          });
        }
      }
    }
    for (let j = i + 1; j < bookings.length; j++) {
      const o = bookings[j];
      if (o.room_id === b.room_id && rangesOverlap(b.check_in, b.check_out, o.check_in, o.check_out)) {
        out.push({ entry: { id: null, title: null }, room_id: o.room_id, check_in: o.check_in, check_out: o.check_out, booking: b });
      }
    }
  });
  return out;
}

/**
 * Sessions of one entry may not overlap each other. Returns index pairs.
 * @param {Session[]} sessions
 */
export function internalOverlaps(sessions) {
  /** @type {[number, number][]} */
  const pairs = [];
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      if (sessionsOverlap(sessions[i], sessions[j])) pairs.push([i, j]);
    }
  }
  return pairs;
}

/**
 * Busy intervals for one date, as seen by a new entry of `type` in `spaceId`.
 * For a blocked slot with no space, every space counts.
 * @param {string} date
 * @param {{type: EntryLike['type'], space_id: string|null|undefined, id?: string}} probe
 * @param {EntryLike[]} existing
 */
export function busyOn(date, probe, existing) {
  /** @type {{start: string, end: string, entry: EntryLike}[]} */
  const out = [];
  for (const other of existing) {
    if (probe.id && other.id === probe.id) continue;
    const kind = spaceRule({ type: probe.type, space_id: probe.space_id, sessions: [] }, other);
    if (!kind) continue;
    for (const s of other.sessions) if (s.date === date) out.push({ start: s.start, end: s.end, entry: other });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Entries with sessions on `date` in other spaces (the calm info note).
 * @param {EntryLike} candidate @param {string} date @param {EntryLike[]} existing
 */
export function sameDayOthers(candidate, date, existing) {
  return existing.filter(
    (o) =>
      o.id !== candidate.id &&
      o.type !== 'room_only' &&
      o.sessions.some((s) => s.date === date) &&
      !spaceRule(candidate, o) &&
      (o.space_id ?? null) !== (candidate.space_id ?? null),
  );
}
