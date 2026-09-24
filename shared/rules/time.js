// Date and time helpers. Every calendar computation happens in the
// organisation time zone, whatever the browser's or server's zone is.
// Requires a global Temporal (native, or temporal-polyfill loaded first).

/** @typedef {string} DateStr YYYY-MM-DD */
/** @typedef {string} TimeStr HH:MM */

const T = () => /** @type {any} */ (globalThis).Temporal;

/** @param {DateStr} d */
export const plainDate = (d) => T().PlainDate.from(d);

/** Current instant (overridable in tests through `clock.now`). */
export const clock = {
  /** @returns {number} epoch ms */
  now: () => Date.now(),
};

/** @param {string} tz @param {number} [at] epoch ms */
export function zonedNow(tz, at = clock.now()) {
  return T().Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(tz);
}

/** Today's date in `tz`. @param {string} tz @param {number} [at] */
export function todayIn(tz, at) {
  return zonedNow(tz, at).toPlainDate().toString();
}

/** The current date and minute in `tz`. @param {string} tz @param {number} [at] */
export function nowIn(tz, at) {
  const z = zonedNow(tz, at);
  const minutes = z.hour * 60 + z.minute;
  return { date: z.toPlainDate().toString(), time: fromMinutes(minutes), minutes };
}

/** @param {TimeStr} t */
export function toMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** @param {number} m minutes since midnight (1440 → "24:00") */
export function fromMinutes(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** @param {DateStr} d @param {number} n */
export const addDays = (d, n) => plainDate(d).add({ days: n }).toString();

/** @param {DateStr} d @param {number} n */
export const addMonths = (d, n) => plainDate(d).add({ months: n }).toString();

/** Whole days from a to b (b − a). @param {DateStr} a @param {DateStr} b */
export const diffDays = (a, b) => plainDate(a).until(plainDate(b), { largestUnit: 'day' }).days;

/** ISO weekday: 1 = Monday … 7 = Sunday. @param {DateStr} d */
export const weekdayOf = (d) => plainDate(d).dayOfWeek;

/** @param {DateStr} d */
export const daysInMonthOf = (d) => plainDate(d).daysInMonth;

/** Monday of the week containing `d`. @param {DateStr} d */
export const startOfWeek = (d) => addDays(d, 1 - weekdayOf(d));

/** @param {DateStr} d */
export const startOfMonth = (d) => `${d.slice(0, 7)}-01`;

/** @param {DateStr} d */
export const endOfMonth = (d) => `${d.slice(0, 7)}-${String(daysInMonthOf(d)).padStart(2, '0')}`;

/** 42 dates of a 6-row, Monday-first month grid. @param {string} ym YYYY-MM */
export function monthGrid(ym) {
  const first = `${ym}-01`;
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Dates from a to b inclusive. @param {DateStr} a @param {DateStr} b */
export function dateRange(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The UTC instant of a local date/time in `tz` ("24:00" = next day 00:00).
 * Ambiguous or skipped times around DST resolve with Temporal's "compatible" rule.
 * @param {DateStr} date @param {TimeStr} time @param {string} tz
 */
export function localToUtc(date, time, tz) {
  let d = date;
  let t = time;
  if (t === '24:00') {
    d = addDays(date, 1);
    t = '00:00';
  }
  const z = T().PlainDateTime.from(`${d}T${t}`).toZonedDateTime(tz, { disambiguation: 'compatible' });
  return new Date(z.epochMilliseconds).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Is the slot starting at `date` `time` before the current moment in `tz`?
 * "Past" = dates before today, and today's time before the current hour
 * (so the current hour is still selectable).
 * @param {DateStr} date @param {TimeStr} time @param {string} tz @param {number} [at]
 */
export function isPastSlot(date, time, tz, at) {
  const now = nowIn(tz, at);
  if (date < now.date) return true;
  if (date > now.date) return false;
  return toMinutes(time) < Math.floor(now.minutes / 60) * 60;
}

/** Has the moment `date` `time` already passed? @param {DateStr} date @param {TimeStr} time @param {string} tz @param {number} [at] */
export function isPastMoment(date, time, tz, at) {
  const now = nowIn(tz, at);
  if (date !== now.date) return date < now.date;
  return toMinutes(time) <= now.minutes;
}

/**
 * Default start for a new entry: the next full hour today, rolling to
 * tomorrow 09:00 when that would be later than 21:00.
 * @param {string} tz @param {number} [at]
 */
export function defaultStart(tz, at) {
  const now = nowIn(tz, at);
  const next = Math.floor(now.minutes / 60) * 60 + 60;
  if (next > 21 * 60) return { date: addDays(now.date, 1), time: '09:00' };
  return { date: now.date, time: fromMinutes(next) };
}

/** The next full hour (for posts); may roll into tomorrow. @param {string} tz @param {number} [at] */
export function nextFullHour(tz, at) {
  const now = nowIn(tz, at);
  const next = Math.floor(now.minutes / 60) * 60 + 60;
  if (next >= 24 * 60) return { date: addDays(now.date, 1), time: '00:00' };
  return { date: now.date, time: fromMinutes(next) };
}

/** Is `tz` a valid IANA time zone? @param {string} tz */
export function isValidTimeZone(tz) {
  try {
    T().Now.zonedDateTimeISO(tz);
    return true;
  } catch {
    return false;
  }
}
