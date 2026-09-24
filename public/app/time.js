// Calendar time in the organisation time zone, plus Intl formatting in the UI locale.
import { orgTz } from './state/session.js';
import { intlLocale } from './i18n/index.js';
import * as rules from '/shared/rules/time.js';

export * from '/shared/rules/time.js';

export const today = () => rules.todayIn(orgTz.value);
export const now = () => rules.nowIn(orgTz.value);
/** @param {string} date @param {string} time */
export const isPastSlot = (date, time) => rules.isPastSlot(date, time, orgTz.value);
/** @param {string} date @param {string} time */
export const isPastMoment = (date, time) => rules.isPastMoment(date, time, orgTz.value);
export const defaultStart = () => rules.defaultStart(orgTz.value);
export const nextFullHour = () => rules.nextFullHour(orgTz.value);

const fmtCache = new Map();
/** @param {Intl.DateTimeFormatOptions} opts */
function dtf(opts) {
  const key = intlLocale() + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat(intlLocale(), { ...opts, timeZone: 'UTC' })));
  return f;
}
/** A plain date as a UTC Date at noon (formatting only). @param {string} d */
const asDate = (d) => new Date(`${d}T12:00:00Z`);

/** "joi, 1 oct. 2026" @param {string} d */
export const fmtDateLong = (d) => dtf({ weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(asDate(d));
/** "joi 1 oct." @param {string} d */
export const fmtDateShort = (d) => dtf({ weekday: 'short', day: 'numeric', month: 'short' }).format(asDate(d));
/** "1 oct." @param {string} d */
export const fmtDayMonth = (d) => dtf({ day: 'numeric', month: 'short' }).format(asDate(d));
/** "1 oct. 2026" @param {string} d */
export const fmtDate = (d) => dtf({ day: 'numeric', month: 'short', year: 'numeric' }).format(asDate(d));
/** "octombrie 2026" @param {string} ym YYYY-MM */
export const fmtMonthYear = (ym) => dtf({ month: 'long', year: 'numeric' }).format(asDate(`${ym}-01`));
/** "octombrie" @param {string} ym */
export const fmtMonth = (ym) => dtf({ month: 'long' }).format(asDate(`${ym}-01`));
/** "oct." @param {string} ym */
export const fmtMonthShort = (ym) => dtf({ month: 'short' }).format(asDate(`${ym}-01`));
/** Weekday names Monday-first. @param {'narrow'|'short'|'long'} style */
export function weekdayNames(style = 'short') {
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => dtf({ weekday: style }).format(asDate(rules.addDays('2024-01-01', i))));
}
/** Session time range "18:00–20:00". @param {string} a @param {string} b */
export const fmtTimeRange = (a, b) => `${a}–${b}`;

/** Local date/time of an ISO instant in the org zone, e.g. "24 sept. 2026, 10:00". @param {string} iso */
export function fmtInstant(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(intlLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: orgTz.value,
  }).format(new Date(iso));
}

/** Duration "2 h 30 min". @param {number} minutes */
export function fmtDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/** Money from cents. @param {number} cents @param {string} currency */
export function fmtMoney(cents, currency) {
  return new Intl.NumberFormat(intlLocale(), {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Bytes → "1,2 MB". @param {number} n */
export function fmtBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: v < 10 && i ? 1 : 0 }).format(v)} ${units[i]}`;
}

/** @param {number} n */
export const fmtNumber = (n) => new Intl.NumberFormat(intlLocale()).format(n);
