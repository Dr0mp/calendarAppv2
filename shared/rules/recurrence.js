// Recurrence rules (§5.5). Pure functions shared by the browser (live
// preview) and the server (materialising occurrences).

import { addDays, addMonths, daysInMonthOf, startOfWeek, weekdayOf, diffDays } from './time.js';

/**
 * @typedef {{
 *   freq: 'weekly'|'monthly_day'|'monthly_weekday',
 *   interval?: number,
 *   weekdays?: number[],
 *   count?: number,
 *   until?: string,
 * }} Rule
 */

export const MIN_COUNT = 2;
export const MAX_COUNT = 52;
export const MAX_MONTHS = 12;
/** Hard cap on generated occurrences (e.g. two weekdays a week for a year). */
export const MAX_OCCURRENCES = 120;

/** Latest allowed "until" date for a series starting on `start`. @param {string} start */
export const maxUntil = (start) => addMonths(start, MAX_MONTHS);

/**
 * Which week of the month a date falls in (1–5), and whether it's the last.
 * @param {string} d
 */
export function nthWeekday(d) {
  const day = Number(d.slice(8, 10));
  const n = Math.ceil(day / 7);
  const last = day + 7 > daysInMonthOf(d);
  return { n, last, weekday: weekdayOf(d) };
}

/**
 * The date of the n-th `weekday` (1 = Monday) in the month of `ym-01`.
 * n = 5 (or `last`) falls back to the last such weekday of the month.
 * @param {string} monthStart YYYY-MM-01 @param {number} weekday @param {number} n @param {boolean} [last]
 */
export function nthWeekdayOfMonth(monthStart, weekday, n, last = false) {
  const firstWd = weekdayOf(monthStart);
  const first = addDays(monthStart, (weekday - firstWd + 7) % 7);
  const dim = daysInMonthOf(monthStart);
  let d = addDays(first, (n - 1) * 7);
  if (last || Number(d.slice(8, 10)) > dim || d.slice(0, 7) !== monthStart.slice(0, 7)) {
    // Last occurrence of that weekday in the month.
    d = first;
    while (addDays(d, 7).slice(0, 7) === monthStart.slice(0, 7)) d = addDays(d, 7);
  }
  return d;
}

/**
 * Expand a rule from the anchor date. Returns every occurrence date in
 * order (the anchor is always the first), before exceptions are removed.
 * The count includes dates that will be skipped.
 * @param {Rule} rule @param {string} start YYYY-MM-DD
 * @returns {string[]}
 */
export function expandRule(rule, start) {
  const out = [start];
  const limit = rule.count ? Math.min(rule.count, MAX_COUNT) : MAX_OCCURRENCES;
  const until = rule.until && rule.until < maxUntil(start) ? rule.until : maxUntil(start);
  const interval = Math.max(1, rule.interval ?? 1);
  const done = () => out.length >= limit;

  if (rule.freq === 'weekly') {
    const days = [...new Set(rule.weekdays?.length ? rule.weekdays : [weekdayOf(start)])].sort();
    const week0 = startOfWeek(start);
    for (let k = 0; !done(); k += interval) {
      const weekStart = addDays(week0, 7 * k);
      if (weekStart > until) break;
      for (const wd of days) {
        const d = addDays(weekStart, wd - 1);
        if (d <= start || d > until) continue;
        out.push(d);
        if (done()) break;
      }
      if (k > 60 * 7) break;
    }
  } else if (rule.freq === 'monthly_day') {
    const day = Number(start.slice(8, 10));
    const month0 = `${start.slice(0, 7)}-01`;
    for (let k = interval; !done(); k += interval) {
      const ms = addMonths(month0, k);
      const d = `${ms.slice(0, 8)}${String(Math.min(day, daysInMonthOf(ms))).padStart(2, '0')}`;
      if (d > until) break;
      out.push(d);
    }
  } else if (rule.freq === 'monthly_weekday') {
    const { n, weekday } = nthWeekday(start);
    const month0 = `${start.slice(0, 7)}-01`;
    for (let k = interval; !done(); k += interval) {
      const d = nthWeekdayOfMonth(addMonths(month0, k), weekday, n, n === 5);
      if (d > until) break;
      out.push(d);
    }
  }
  return out;
}

/**
 * Occurrence dates after removing the skipped ones.
 * @param {Rule} rule @param {string} start @param {string[]} [exceptions]
 */
export function occurrences(rule, start, exceptions = []) {
  const skip = new Set(exceptions);
  return expandRule(rule, start).filter((d) => !skip.has(d));
}

/**
 * Shift a list of sessions (anchored on one day) to another date.
 * @template {{date: string}} T
 * @param {T[]} items @param {string} from @param {string} to
 * @returns {T[]}
 */
export function shiftTo(items, from, to) {
  const n = diffDays(from, to);
  return items.map((s) => ({ ...s, date: addDays(s.date, n) }));
}

/**
 * Shift room bookings by the same number of days as the occurrence.
 * @template {{check_in: string, check_out: string}} T
 * @param {T[]} bookings @param {string} from @param {string} to
 * @returns {T[]}
 */
export function shiftBookings(bookings, from, to) {
  const n = diffDays(from, to);
  return bookings.map((b) => ({ ...b, check_in: addDays(b.check_in, n), check_out: addDays(b.check_out, n) }));
}

/**
 * Validate a rule for a series starting on `start`. Returns an error code or null.
 * @param {Rule} rule @param {string} start
 */
export function ruleError(rule, start) {
  if (!['weekly', 'monthly_day', 'monthly_weekday'].includes(rule.freq)) return 'invalid_rule';
  if (!rule.count && !rule.until) return 'rule_end_required';
  if (rule.count && (rule.count < MIN_COUNT || rule.count > MAX_COUNT)) return 'rule_count_range';
  if (rule.until && (rule.until <= start || rule.until > maxUntil(start))) return 'rule_until_range';
  if (rule.freq === 'weekly' && rule.weekdays && rule.weekdays.some((d) => d < 1 || d > 7)) return 'invalid_rule';
  if ((rule.interval ?? 1) < 1 || (rule.interval ?? 1) > 12) return 'invalid_rule';
  return null;
}
