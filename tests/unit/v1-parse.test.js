import '../setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingsFromV1, cleanUsername, firstInt, nearestOwnerColor, parseCapacity, parseDurationSeconds, parseFileSizeMb, parsePrice, parseRatio, sessionsFromV1,
} from '../../server/import/v1-parse.js';

test('colours map to the nearest owner preset by hue', () => {
  assert.equal(nearestOwnerColor('#ef4444'), 'owner-1'); // red
  assert.equal(nearestOwnerColor('#22c55e'), 'owner-5'); // green
  assert.equal(nearestOwnerColor('#38bdf8'), 'owner-8'); // sky
  assert.equal(nearestOwnerColor('#8b5cf6'), 'owner-10'); // violet
  assert.equal(nearestOwnerColor('#777777'), 'owner-7'); // grey
  assert.equal(nearestOwnerColor('nope'), 'owner-7');
  assert.equal(nearestOwnerColor(undefined), 'owner-7');
});

test('numbers in text', () => {
  assert.equal(parseCapacity('80 persoane'), 80);
  assert.equal(parseCapacity(12), 12);
  assert.equal(parseCapacity('multe'), null);
  assert.deepEqual(parseRatio('9:16'), [9, 16]);
  assert.deepEqual(parseRatio('4:5 or 1:1'), [4, 5]);
  assert.deepEqual(parseRatio('1.91:1'), [191, 100]);
  assert.equal(parseRatio('square'), null);
  assert.equal(parseDurationSeconds('10 mins (sweet spot: 15-60s)'), 600);
  assert.equal(parseDurationSeconds('90s (recommended) / up to 15 mins'), 90);
  assert.equal(parseDurationSeconds('2 hours'), 7200);
  assert.equal(parseDurationSeconds('Static image'), null);
  assert.equal(parseFileSizeMb('287.6 MB (iOS) / 72 MB (Android)'), 72);
  assert.equal(parseFileSizeMb('4 GB'), 4096);
  assert.equal(parseFileSizeMb('500 KB'), 1);
  assert.equal(parseFileSizeMb('n/a'), null);
  assert.equal(firstInt('80-100 characters'), 80);
  assert.equal(firstInt(2200), 2200);
  assert.equal(firstInt('none'), null);
});

test('prices', () => {
  assert.deepEqual(parsePrice('75 lei'), { price_cents: 7500, currency: 'RON', price_note: null, warning: null });
  assert.deepEqual(parsePrice('€45'), { price_cents: 4500, currency: 'EUR', price_note: null, warning: null });
  assert.deepEqual(parsePrice('12,50 €'), { price_cents: 1250, currency: 'EUR', price_note: null, warning: null });
  assert.deepEqual(parsePrice('$75'), { price_cents: 7500, currency: 'EUR', price_note: null, warning: 'currency_assumed' });
  assert.deepEqual(parsePrice('100', 'EUR'), { price_cents: 10000, currency: 'EUR', price_note: null, warning: null });
  assert.deepEqual(parsePrice('Free (Team Internal)'), { price_cents: null, currency: null, price_note: 'Team Internal', warning: null });
  assert.deepEqual(parsePrice('Gratuit'), { price_cents: null, currency: null, price_note: null, warning: null });
  assert.deepEqual(parsePrice(''), { price_cents: null, currency: null, price_note: null, warning: null });
  assert.equal(parsePrice('donație la intrare').warning, 'price_unparsed');
});

test('sessions: per day, split at midnight, or separate hours', () => {
  assert.deepEqual(sessionsFromV1({ startDate: '2026-10-01', endDate: '2026-10-02', hour: '9:30', durationHours: 1.5 }), [
    { date: '2026-10-01', start: '09:30', end: '11:00' },
    { date: '2026-10-02', start: '09:30', end: '11:00' },
  ]);
  assert.deepEqual(sessionsFromV1({ startDate: '2026-10-01', hour: '23:00', durationHours: 2 }), [
    { date: '2026-10-01', start: '23:00', end: '24:00' },
    { date: '2026-10-02', start: '00:00', end: '01:00' },
  ]);
  assert.deepEqual(sessionsFromV1({ startDate: '2026-10-01', scheduledHours: ['14:00', '10:00', 'x'] }), [
    { date: '2026-10-01', start: '10:00', end: '11:00' },
    { date: '2026-10-01', start: '14:00', end: '15:00' },
  ]);
  assert.deepEqual(sessionsFromV1({ date: '2026-10-01', time: '18:00' }), [{ date: '2026-10-01', start: '18:00', end: '20:00' }]);
  assert.deepEqual(sessionsFromV1({ entryType: 'room_only', startDate: '2026-10-01' }), []);
  assert.deepEqual(sessionsFromV1({}), []);
});

test('bookings: inclusive v1 end dates become the next day', () => {
  assert.deepEqual(bookingsFromV1({ roomBookings: [{ roomId: 'r1', startDate: '2026-10-01', endDate: '2026-10-03' }] }), [{ roomId: 'r1', check_in: '2026-10-01', check_out: '2026-10-04' }]);
  assert.deepEqual(bookingsFromV1({ roomId: 'r2', startDate: '2026-10-01', endDate: '2026-10-01' }), [{ roomId: 'r2', check_in: '2026-10-01', check_out: '2026-10-02' }]);
  assert.deepEqual(bookingsFromV1({}), []);
});

test('usernames', () => {
  assert.equal(cleanUsername('Ana.Pop'), 'ana.pop');
  assert.equal(cleanUsername('Ștefan Ionescu'), 'stefan.ionescu');
  assert.equal(cleanUsername('ab'), 'ab0');
});
