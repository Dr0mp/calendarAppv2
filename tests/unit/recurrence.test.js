import '../setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandRule, occurrences, nthWeekday, nthWeekdayOfMonth, shiftTo, shiftBookings, ruleError, maxUntil } from '../../shared/rules/recurrence.js';

test('weekly: every week on the start weekday', () => {
  assert.deepEqual(expandRule({ freq: 'weekly', count: 4 }, '2026-10-01'), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']);
});

test('weekly: several weekdays, every 2 weeks, until a date', () => {
  // Start Tue 6 Oct 2026; Tue + Thu every other week, until 31 Oct.
  assert.deepEqual(expandRule({ freq: 'weekly', interval: 2, weekdays: [2, 4], until: '2026-10-31' }, '2026-10-06'), [
    '2026-10-06', '2026-10-08', '2026-10-20', '2026-10-22',
  ]);
});

test('monthly, same day: short months use their last day', () => {
  assert.deepEqual(expandRule({ freq: 'monthly_day', count: 5 }, '2026-01-31'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.deepEqual(expandRule({ freq: 'monthly_day', count: 3 }, '2027-12-30'), ['2027-12-30', '2028-01-30', '2028-02-29']);
});

test('monthly, same weekday: the 3rd Thursday', () => {
  // 15 Oct 2026 is the 3rd Thursday.
  assert.deepEqual(nthWeekday('2026-10-15'), { n: 3, last: false, weekday: 4 });
  assert.deepEqual(expandRule({ freq: 'monthly_weekday', count: 4 }, '2026-10-15'), ['2026-10-15', '2026-11-19', '2026-12-17', '2027-01-21']);
});

test('monthly, same weekday: the 5th weekday falls back to the last one', () => {
  // 29 Oct 2026 is the 5th Thursday; November has only four.
  assert.equal(nthWeekday('2026-10-29').n, 5);
  assert.deepEqual(expandRule({ freq: 'monthly_weekday', count: 3 }, '2026-10-29'), ['2026-10-29', '2026-11-26', '2026-12-31']);
  assert.equal(nthWeekdayOfMonth('2027-02-01', 1, 5), '2027-02-22');
  assert.equal(nthWeekdayOfMonth('2026-11-01', 4, 2), '2026-11-12');
});

test('until is capped at 12 months; count at 52', () => {
  const long = expandRule({ freq: 'weekly', until: '2030-01-01' }, '2026-10-01');
  assert.ok(long.at(-1) <= maxUntil('2026-10-01'));
  assert.equal(expandRule({ freq: 'weekly', count: 99 }, '2026-10-01').length, 52);
});

test('exceptions skip dates (and still count toward N)', () => {
  assert.deepEqual(occurrences({ freq: 'weekly', count: 4 }, '2026-10-01', ['2026-10-08']), ['2026-10-01', '2026-10-15', '2026-10-22']);
});

test('shifting sessions and room bookings per occurrence', () => {
  assert.deepEqual(shiftTo([{ date: '2026-10-01', start: '10:00' }, { date: '2026-10-01', start: '14:00' }], '2026-10-01', '2026-11-05'), [
    { date: '2026-11-05', start: '10:00' }, { date: '2026-11-05', start: '14:00' },
  ]);
  assert.deepEqual(shiftBookings([{ room_id: 'r', check_in: '2026-09-30', check_out: '2026-10-02' }], '2026-10-01', '2026-10-08'), [
    { room_id: 'r', check_in: '2026-10-07', check_out: '2026-10-09' },
  ]);
});

test('rule validation', () => {
  assert.equal(ruleError({ freq: 'weekly', count: 4 }, '2026-10-01'), null);
  assert.equal(ruleError({ freq: 'weekly' }, '2026-10-01'), 'rule_end_required');
  assert.equal(ruleError({ freq: 'weekly', count: 1 }, '2026-10-01'), 'rule_count_range');
  assert.equal(ruleError({ freq: 'weekly', count: 53 }, '2026-10-01'), 'rule_count_range');
  assert.equal(ruleError({ freq: 'weekly', until: '2027-12-01' }, '2026-10-01'), 'rule_until_range');
  assert.equal(ruleError({ freq: 'weekly', until: '2026-09-01' }, '2026-10-01'), 'rule_until_range');
  assert.equal(ruleError({ freq: 'yearly', count: 3 }, '2026-10-01'), 'invalid_rule');
  assert.equal(ruleError({ freq: 'weekly', count: 3, weekdays: [8] }, '2026-10-01'), 'invalid_rule');
  assert.equal(ruleError({ freq: 'weekly', count: 3, interval: 13 }, '2026-10-01'), 'invalid_rule');
});
