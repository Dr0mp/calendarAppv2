// Pure calendar logic shared by the views and the unit tests: items per
// day, the side-by-side layout of overlapping sessions, search and filters.
import { addDays, endOfMonth, toMinutes } from './time.js';

/**
 * @typedef {{entry: any, kind: 'session'|'stay', date: string, start: string|null, end: string|null, key: string}} DayItem
 */

/**
 * Items per date: every session, and a night-by-night "stay" for room-only
 * bookings (check-out day excluded). Multi-day entries show on every day.
 * @param {any[]} entries
 * @returns {Map<string, DayItem[]>}
 */
export function itemsByDate(entries) {
  /** @type {Map<string, DayItem[]>} */
  const map = new Map();
  const push = (/** @type {string} */ d, /** @type {DayItem} */ it) => {
    let list = map.get(d);
    if (!list) map.set(d, (list = []));
    list.push(it);
  };
  for (const e of entries) {
    for (const s of e.sessions) {
      push(s.date, { entry: e, kind: 'session', date: s.date, start: s.start, end: s.end, key: `${e.id}|${s.date}|${s.start}` });
    }
    if (e.type === 'room_only') {
      for (const b of e.room_bookings) {
        for (let d = b.check_in; d < b.check_out; d = addDays(d, 1)) {
          push(d, { entry: e, kind: 'stay', date: d, start: null, end: null, key: `${e.id}|${b.id ?? b.room_id}|${d}` });
        }
      }
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.kind === b.kind ? (a.start ?? '').localeCompare(b.start ?? '') : a.kind === 'stay' ? -1 : 1));
  }
  return map;
}

/**
 * Lay out overlapping sessions side by side: each item gets a column index
 * and the number of columns in its overlap cluster.
 * @param {DayItem[]} items sessions of one day
 */
export function layoutColumns(items) {
  const sorted = [...items].sort((a, b) => toMinutes(/** @type {string} */ (a.start)) - toMinutes(/** @type {string} */ (b.start)) || toMinutes(/** @type {string} */ (b.end)) - toMinutes(/** @type {string} */ (a.end)));
  /** @type {{item: DayItem, col: number, cols: number}[]} */
  const out = [];
  /** @type {{item: DayItem, col: number, cols: number}[]} */
  let cluster = [];
  let clusterEnd = -1;
  /** @type {number[]} column end times */
  let colEnds = [];
  const flush = () => {
    const n = colEnds.length;
    for (const c of cluster) c.cols = n;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const it of sorted) {
    const s = toMinutes(/** @type {string} */ (it.start));
    const e = toMinutes(/** @type {string} */ (it.end));
    if (cluster.length && s >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(e);
    } else colEnds[col] = e;
    cluster.push({ item: it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, e);
  }
  if (cluster.length) flush();
  return out;
}

/** Fold for search: case- and diacritic-insensitive. @param {string} s */
export const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Does an entry match the search (title, description, space, rooms, owner,
 * guest names)? Redacted fields are already absent.
 * @param {any} e @param {string} q folded query
 */
export function matches(e, q) {
  if (!q) return true;
  const hay = [
    e.title,
    e.description,
    e.space?.name,
    e.owner.name,
    ...e.room_bookings.map((/** @type {any} */ b) => `${b.room_name ?? ''} ${b.guest_names ?? ''}`),
  ]
    .filter(Boolean)
    .join(' ');
  return fold(hay).includes(q);
}

/**
 * Apply the filter dimensions. `skip` leaves one dimension out (for counts).
 * @param {any[]} entries
 * @param {{types: string[], spaces: string[], owner: string}} f
 * @param {string} me
 * @param {'types'|'spaces'|'owner'|null} [skip]
 */
export function applyFilters(entries, f, me, skip = null) {
  return entries.filter((e) => {
    if (skip !== 'types' && f.types.length && !f.types.includes(e.type)) return false;
    if (skip !== 'spaces' && f.spaces.length && !(e.space_id && f.spaces.includes(e.space_id))) return false;
    if (skip !== 'owner' && f.owner) {
      const o = f.owner === 'me' ? me : f.owner;
      if (e.owner.id !== o) return false;
    }
    return true;
  });
}

/** Entries that touch a month, including those spanning it. @param {any[]} entries @param {string} ym */
export function countInMonth(entries, ym) {
  const from = `${ym}-01`;
  const to = endOfMonth(from);
  return entries.filter((e) => e.first_date <= to && e.last_date >= from).length;
}
