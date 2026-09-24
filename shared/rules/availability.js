// Free-slot suggestions (§5.4). Pure: the caller supplies an `isFree` check
// (backed by the shared conflict rules) and the current moment.

import { addDays, fromMinutes, toMinutes } from './time.js';

export const DAY_START = 8 * 60;
export const DAY_END = 22 * 60;
export const STEP = 30;
export const NEXT_DAY_WINDOW = 30;

/**
 * @typedef {{date: string, start: string, end: string}} Session
 * @typedef {{kind: 'same_day'|'next_free_day'|'next_week', session: Session}} Suggestion
 */

/**
 * Up to three alternatives for a conflicting session:
 *  1. the first free slot of the same duration on the same day, at or after
 *     08:00, not past, ending by 22:00;
 *  2. the same time on the next day (within 30 days) where that range is free;
 *  3. the same time a week later, if free.
 * Never proposes a past time.
 * @param {Session} session
 * @param {{isFree: (s: Session) => boolean, isPast: (date: string, time: string) => boolean}} ctx
 * @returns {Suggestion[]}
 */
export function suggestAlternatives(session, ctx) {
  const start = toMinutes(session.start);
  const duration = toMinutes(session.end) - start;
  /** @type {Suggestion[]} */
  const out = [];
  const seen = new Set();
  /** @param {Suggestion['kind']} kind @param {Session} s */
  const push = (kind, s) => {
    const key = `${s.date} ${s.start}`;
    if (seen.has(key) || key === `${session.date} ${session.start}`) return;
    seen.add(key);
    out.push({ kind, session: s });
  };

  // 1. First free hour on the same day.
  for (let m = DAY_START; m + duration <= DAY_END; m += STEP) {
    const s = { date: session.date, start: fromMinutes(m), end: fromMinutes(m + duration) };
    if (m === start) continue;
    if (ctx.isPast(s.date, s.start)) continue;
    if (ctx.isFree(s)) {
      push('same_day', s);
      break;
    }
  }

  // 2. Same time, next free day (a real availability check).
  for (let d = 1; d <= NEXT_DAY_WINDOW; d++) {
    const s = { ...session, date: addDays(session.date, d) };
    if (ctx.isPast(s.date, s.start)) continue;
    if (ctx.isFree(s)) {
      push('next_free_day', s);
      break;
    }
  }

  // 3. Same day next week.
  const week = { ...session, date: addDays(session.date, 7) };
  if (!ctx.isPast(week.date, week.start) && ctx.isFree(week)) push('next_week', week);

  return out.slice(0, 3);
}

/**
 * Hour cells for the availability strip.
 * @param {string} date
 * @param {{start: string, end: string, entry: any}[]} busy busy intervals that day
 * @param {Session|null} selected the current session (if on this date)
 * @param {(date: string, time: string) => boolean} isPast
 * @param {boolean} fullDay 00–24 instead of 08–22
 */
export function stripCells(date, busy, selected, isPast, fullDay = false) {
  const from = fullDay ? 0 : DAY_START;
  const to = fullDay ? 24 * 60 : DAY_END;
  const cells = [];
  for (let m = from; m < to; m += 60) {
    const start = fromMinutes(m);
    const end = fromMinutes(m + 60);
    const hits = busy.filter((b) => toMinutes(b.start) < m + 60 && m < toMinutes(b.end));
    const sel = selected && selected.date === date && toMinutes(selected.start) < m + 60 && m < toMinutes(selected.end);
    /** @type {'free'|'busy'|'past'|'selected'} */
    let state = 'free';
    if (sel) state = 'selected';
    else if (hits.length) state = 'busy';
    else if (isPast(date, start)) state = 'past';
    cells.push({ start, end, state, busy: hits.map((h) => h.entry), conflict: !!(sel && hits.length) });
  }
  return cells;
}
