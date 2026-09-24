import '../setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../shared/rules/time.js';

const TZ = 'Europe/Bucharest';
const at = (iso) => Date.parse(iso);

test('today and now are computed in the organisation zone, not UTC', () => {
  // 22:30 UTC on 24 Sep is already 25 Sep 01:30 in Bucharest (UTC+3).
  assert.equal(T.todayIn(TZ, at('2026-09-24T22:30:00Z')), '2026-09-25');
  assert.deepEqual(T.nowIn(TZ, at('2026-09-24T22:30:00Z')), { date: '2026-09-25', time: '01:30', minutes: 90 });
  assert.equal(T.todayIn('UTC', at('2026-09-24T22:30:00Z')), '2026-09-24');
});

test('minutes conversion, including 24:00', () => {
  assert.equal(T.toMinutes('18:30'), 1110);
  assert.equal(T.fromMinutes(1110), '18:30');
  assert.equal(T.fromMinutes(1440), '24:00');
  assert.equal(T.fromMinutes(5), '00:05');
});

test('date arithmetic', () => {
  assert.equal(T.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(T.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(T.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(T.diffDays('2026-09-24', '2026-10-01'), 7);
  assert.equal(T.weekdayOf('2026-09-24'), 4);
  assert.equal(T.startOfWeek('2026-09-24'), '2026-09-21');
  assert.equal(T.startOfWeek('2026-09-27'), '2026-09-21');
  assert.equal(T.startOfMonth('2026-09-24'), '2026-09-01');
  assert.equal(T.endOfMonth('2026-02-10'), '2026-02-28');
  assert.equal(T.daysInMonthOf('2024-02-01'), 29);
  assert.deepEqual(T.dateRange('2026-09-29', '2026-10-02'), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
});

test('month grid: 42 days, Monday first', () => {
  const g = T.monthGrid('2026-09');
  assert.equal(g.length, 42);
  assert.equal(g[0], '2026-08-31');
  assert.equal(T.weekdayOf(g[0]), 1);
  assert.equal(g[41], '2026-10-11');
});

test('local to UTC across the DST changes', () => {
  assert.equal(T.localToUtc('2026-09-24', '18:00', TZ), '2026-09-24T15:00:00Z');
  assert.equal(T.localToUtc('2026-12-01', '18:00', TZ), '2026-12-01T16:00:00Z');
  // 24:00 is next-day midnight
  assert.equal(T.localToUtc('2026-09-24', '24:00', TZ), '2026-09-24T21:00:00Z');
  // Spring forward: 29 Mar 2026, 03:00 → 04:00 local. 03:30 does not exist.
  assert.equal(T.localToUtc('2026-03-29', '02:30', TZ), '2026-03-29T00:30:00Z');
  assert.equal(T.localToUtc('2026-03-29', '03:30', TZ), '2026-03-29T01:30:00Z');
  assert.equal(T.localToUtc('2026-03-29', '04:00', TZ), '2026-03-29T01:00:00Z');
  // Fall back: 25 Oct 2026, 04:00 → 03:00 local. 03:30 happens twice; the earlier one wins.
  assert.equal(T.localToUtc('2026-10-25', '03:30', TZ), '2026-10-25T00:30:00Z');
  assert.equal(T.localToUtc('2026-10-25', '05:00', TZ), '2026-10-25T03:00:00Z');
});

test('past rules: dates before today and hours before the current one', () => {
  const now = at('2026-09-24T11:20:00Z'); // 14:20 local
  assert.equal(T.isPastSlot('2026-09-23', '23:00', TZ, now), true);
  assert.equal(T.isPastSlot('2026-09-24', '13:00', TZ, now), true);
  assert.equal(T.isPastSlot('2026-09-24', '14:00', TZ, now), false, 'the current hour is selectable');
  assert.equal(T.isPastSlot('2026-09-25', '00:00', TZ, now), false);
  assert.equal(T.isPastMoment('2026-09-24', '14:20', TZ, now), true);
  assert.equal(T.isPastMoment('2026-09-24', '14:21', TZ, now), false);
  assert.equal(T.isPastMoment('2026-09-23', '23:59', TZ, now), true);
  assert.equal(T.isPastMoment('2026-09-25', '00:00', TZ, now), false);
});

test('default start: next full hour, rolling to tomorrow 09:00 after 21:00', () => {
  assert.deepEqual(T.defaultStart(TZ, at('2026-09-24T11:20:00Z')), { date: '2026-09-24', time: '15:00' });
  assert.deepEqual(T.defaultStart(TZ, at('2026-09-24T17:59:00Z')), { date: '2026-09-24', time: '21:00' });
  assert.deepEqual(T.defaultStart(TZ, at('2026-09-24T18:10:00Z')), { date: '2026-09-25', time: '09:00' });
  assert.deepEqual(T.nextFullHour(TZ, at('2026-09-24T20:30:00Z')), { date: '2026-09-25', time: '00:00' });
  assert.deepEqual(T.nextFullHour(TZ, at('2026-09-24T11:20:00Z')), { date: '2026-09-24', time: '15:00' });
});

test('time zone validation', () => {
  assert.equal(T.isValidTimeZone('Europe/Bucharest'), true);
  assert.equal(T.isValidTimeZone('Mars/Olympus'), false);
});

test('clock can be overridden', () => {
  const orig = T.clock.now;
  T.clock.now = () => at('2026-01-01T12:00:00Z');
  assert.equal(T.todayIn(TZ), '2026-01-01');
  T.clock.now = orig;
});
