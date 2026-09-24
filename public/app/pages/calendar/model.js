// Calendar helpers: URL state, ranges, per-day items and the side-by-side
// layout of overlapping sessions.
import { addDays, addMonths, monthGrid, startOfMonth, startOfWeek } from '../../time.js';

export const VIEWS = /** @type {const} */ (['year', 'month', 'week', 'day', 'agenda']);

/**
 * Normalise the `date` param for a view: year → YYYY, month → YYYY-MM,
 * others → YYYY-MM-DD.
 * @param {string} view @param {string|undefined} raw @param {string} today
 */
export function anchorDate(view, raw, today) {
  if (!raw) return today;
  if (/^\d{4}$/.test(raw)) return `${raw}-${today.slice(5, 7)}-01`;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return today;
}

/** The URL `date` value for a view. @param {string} view @param {string} d */
export function dateParam(view, d) {
  if (view === 'year') return d.slice(0, 4);
  if (view === 'month') return d.slice(0, 7);
  return d;
}

/** Visible date range for a view. @param {string} view @param {string} d */
export function rangeFor(view, d) {
  if (view === 'year') return { from: `${d.slice(0, 4)}-01-01`, to: `${d.slice(0, 4)}-12-31` };
  if (view === 'month') {
    const grid = monthGrid(d.slice(0, 7));
    return { from: grid[0], to: grid[41] };
  }
  if (view === 'week') {
    const s = startOfWeek(d);
    return { from: s, to: addDays(s, 6) };
  }
  if (view === 'day') return { from: d, to: d };
  return { from: d, to: addDays(d, 59) };
}

/** Move the anchor one step. @param {string} view @param {string} d @param {1|-1} dir */
export function step(view, d, dir) {
  if (view === 'year') return `${Number(d.slice(0, 4)) + dir}-01-01`;
  if (view === 'month') return addMonths(startOfMonth(d), dir);
  if (view === 'week') return addDays(d, 7 * dir);
  if (view === 'agenda') return addDays(d, 30 * dir);
  return addDays(d, dir);
}

export { itemsByDate, layoutColumns, fold, matches, applyFilters, countInMonth } from '/shared/rules/calendar.js';
