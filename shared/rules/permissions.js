// The permission matrix (§3.2) for entries. The server enforces it; the
// client uses the same functions only to decide what to show.

import { isPastMoment, todayIn } from './time.js';

/** @typedef {{id: string, role: 'user'|'moderator'|'admin'}} Viewer */

/** @param {Viewer|null|undefined} u */
export const isStaff = (u) => u?.role === 'admin' || u?.role === 'moderator';
/** @param {Viewer|null|undefined} u */
export const isAdmin = (u) => u?.role === 'admin';

/**
 * Is an entry entirely in the past? Sessions: the last one has ended.
 * Room-only: the last check-out day has come.
 * @param {{type: string, sessions: {date: string, end: string}[], room_bookings?: {check_out: string}[]}} e
 * @param {string} tz @param {number} [at]
 */
export function isEntryPast(e, tz, at) {
  if (e.sessions.length) {
    const last = e.sessions.reduce((a, b) => (a.date + a.end > b.date + b.end ? a : b));
    if (last.end === '24:00') return last.date < todayIn(tz, at);
    return isPastMoment(last.date, last.end, tz, at);
  }
  const outs = (e.room_bookings ?? []).map((b) => b.check_out).sort();
  if (!outs.length) return false;
  return outs[outs.length - 1] <= todayIn(tz, at);
}

/**
 * Edit rules: owners edit their own entries, admins edit any. Past entries:
 * admins only.
 * @param {{owner_id: string} & Parameters<typeof isEntryPast>[0]} e @param {Viewer} u @param {string} tz @param {number} [at]
 */
export function canEditEntry(e, u, tz, at) {
  if (isAdmin(u)) return true;
  if (e.owner_id !== u.id) return false;
  if (e.type === 'room_only' && !isStaff(u)) return false;
  return !isEntryPast(e, tz, at);
}

/** Owners and admins may delete (past ones too). @param {{owner_id: string, type: string}} e @param {Viewer} u */
export function canDeleteEntry(e, u) {
  if (isAdmin(u)) return true;
  if (e.type === 'room_only' && !isStaff(u)) return false;
  return e.owner_id === u.id;
}

/** Can see private notes, guest names and room-only titles. @param {{owner_id: string}} e @param {Viewer} u */
export const canSeePrivate = (e, u) => isStaff(u) || e.owner_id === u.id;
