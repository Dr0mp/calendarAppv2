import '../setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionsOverlap, rangesOverlap, spaceRule, findSpaceConflicts, findRoomConflicts, internalOverlaps, busyOn, sameDayOthers,
} from '../../shared/rules/conflicts.js';
import { suggestAlternatives, stripCells } from '../../shared/rules/availability.js';
import { isPastSlot } from '../../shared/rules/time.js';

const S = (date, start, end) => ({ date, start, end });
const E = (id, type, space_id, sessions, room_bookings = []) => ({ id, type, space_id, title: id, owner_name: 'Ana', sessions, room_bookings });

test('session overlap is half-open and per date', () => {
  assert.equal(sessionsOverlap(S('2026-10-01', '10:00', '12:00'), S('2026-10-01', '11:00', '13:00')), true);
  assert.equal(sessionsOverlap(S('2026-10-01', '10:00', '12:00'), S('2026-10-01', '12:00', '13:00')), false, 'touching is fine');
  assert.equal(sessionsOverlap(S('2026-10-01', '10:00', '12:00'), S('2026-10-02', '10:00', '12:00')), false);
  assert.equal(sessionsOverlap(S('2026-10-01', '22:00', '24:00'), S('2026-10-01', '23:00', '23:30')), true);
});

test('room ranges: check-out day is free for a new check-in', () => {
  assert.equal(rangesOverlap('2026-10-01', '2026-10-03', '2026-10-03', '2026-10-05'), false);
  assert.equal(rangesOverlap('2026-10-01', '2026-10-03', '2026-10-02', '2026-10-04'), true);
  assert.equal(rangesOverlap('2026-10-02', '2026-10-03', '2026-10-01', '2026-10-05'), true);
});

test('space rules table', () => {
  const ev = (s) => ({ type: 'event', space_id: s, sessions: [] });
  const bl = (s) => ({ type: 'blocked', space_id: s, sessions: [] });
  const ro = { type: 'room_only', space_id: null, sessions: [] };
  assert.equal(spaceRule(ev('A'), ev('A')), 'event');
  assert.equal(spaceRule(ev('A'), ev('B')), null);
  assert.equal(spaceRule(ev('A'), bl('A')), 'blocked');
  assert.equal(spaceRule(ev('A'), bl(null)), 'blocked', 'whole-venue block');
  assert.equal(spaceRule(ev('A'), bl('B')), null);
  assert.equal(spaceRule(bl('A'), ev('A')), 'event');
  assert.equal(spaceRule(bl(null), ev('B')), 'event');
  assert.equal(spaceRule(bl('A'), bl('A')), 'blocked');
  assert.equal(spaceRule(ro, ev('A')), null);
  assert.equal(spaceRule(ev('A'), ro), null, 'room bookings never make a space busy');
});

test('findSpaceConflicts lists each overlapping session and skips itself', () => {
  const existing = [
    E('x', 'event', 'A', [S('2026-10-01', '18:00', '20:00')]),
    E('y', 'blocked', null, [S('2026-10-02', '08:00', '12:00')]),
    E('z', 'event', 'B', [S('2026-10-01', '18:00', '20:00')]),
  ];
  const cand = E('new', 'event', 'A', [S('2026-10-01', '19:00', '21:00'), S('2026-10-02', '11:00', '13:00'), S('2026-10-03', '10:00', '11:00')]);
  const c = findSpaceConflicts(cand, existing);
  assert.deepEqual(c.map((x) => [x.entry.id, x.kind, x.date]), [['x', 'event', '2026-10-01'], ['y', 'blocked', '2026-10-02']]);
  assert.equal(findSpaceConflicts({ ...existing[0] }, existing).length, 0);
});

test('findRoomConflicts: against existing, and between rows of the same form', () => {
  const existing = [E('x', 'room_only', null, [], [{ room_id: 'R1', check_in: '2026-10-01', check_out: '2026-10-03' }])];
  const rows = [
    { room_id: 'R1', check_in: '2026-10-03', check_out: '2026-10-05' },
    { room_id: 'R1', check_in: '2026-10-04', check_out: '2026-10-06' },
    { room_id: 'R2', check_in: '2026-10-01', check_out: '2026-10-02' },
    { room_id: 'R1', check_in: '2026-10-02', check_out: '2026-10-03' },
  ];
  const c = findRoomConflicts(rows, existing);
  assert.equal(c.length, 2);
  assert.equal(c[0].entry.id, null, 'rows 0 and 1 overlap each other');
  assert.equal(c[1].entry.id, 'x');
  assert.equal(findRoomConflicts(rows.slice(3), existing, 'x').length, 0, 'own bookings ignored when editing');
});

test('internal overlaps between sessions of one entry', () => {
  assert.deepEqual(internalOverlaps([S('2026-10-01', '10:00', '11:00'), S('2026-10-01', '10:30', '12:00'), S('2026-10-01', '12:00', '13:00')]), [[0, 1]]);
});

test('busy intervals and same-day others', () => {
  const existing = [
    E('a', 'event', 'A', [S('2026-10-01', '18:00', '20:00')]),
    E('b', 'event', 'B', [S('2026-10-01', '10:00', '11:00')]),
    E('c', 'blocked', null, [S('2026-10-01', '08:00', '09:00')]),
    E('d', 'room_only', null, [], []),
  ];
  assert.deepEqual(busyOn('2026-10-01', { type: 'event', space_id: 'A' }, existing).map((b) => b.entry.id), ['c', 'a']);
  assert.deepEqual(busyOn('2026-10-01', { type: 'blocked', space_id: null }, existing).map((b) => b.entry.id), ['c', 'b', 'a']);
  assert.deepEqual(busyOn('2026-10-01', { type: 'event', space_id: 'A', id: 'a' }, existing).map((b) => b.entry.id), ['c']);
  assert.deepEqual(sameDayOthers(E('n', 'event', 'A', []), '2026-10-01', existing).map((e) => e.id), ['b']);
});

test('suggestions never propose past times and use real availability', () => {
  const tz = 'Europe/Bucharest';
  const now = Date.parse('2026-10-01T09:20:00Z'); // 12:20 local
  const existing = [
    E('a', 'event', 'A', [S('2026-10-01', '13:00', '15:00'), S('2026-10-02', '18:00', '20:00'), S('2026-10-03', '18:00', '20:00')]),
    E('b', 'event', 'B', [S('2026-10-04', '18:00', '20:00')]),
  ];
  const probe = { type: 'event', space_id: 'A' };
  const isFree = (s) => !findSpaceConflicts({ ...probe, sessions: [s] }, existing).length;
  const isPast = (d, t) => isPastSlot(d, t, tz, now);
  const out = suggestAlternatives(S('2026-10-02', '18:00', '20:00'), { isFree, isPast });
  assert.deepEqual(out.map((x) => [x.kind, x.session.date, x.session.start]), [
    ['same_day', '2026-10-02', '08:00'],
    ['next_free_day', '2026-10-04', '18:00'],
    ['next_week', '2026-10-09', '18:00'],
  ]);
  // Today: nothing before 12:00 (the current hour), and 13–15 is busy.
  const today = suggestAlternatives(S('2026-10-01', '13:00', '15:00'), { isFree, isPast });
  assert.deepEqual(today[0], { kind: 'same_day', session: S('2026-10-01', '15:00', '17:00') });
  // A long session that doesn't fit by 22:00 gets no same-day suggestion.
  const long = suggestAlternatives(S('2026-10-01', '13:00', '24:00'), { isFree: () => false, isPast });
  assert.deepEqual(long, []);
});

test('availability strip cells', () => {
  const tz = 'Europe/Bucharest';
  const now = Date.parse('2026-10-01T09:20:00Z');
  const busy = [{ start: '13:00', end: '15:00', entry: { id: 'a' } }];
  const cells = stripCells('2026-10-01', busy, S('2026-10-01', '14:00', '16:00'), (d, t) => isPastSlot(d, t, tz, now));
  assert.equal(cells.length, 14);
  assert.equal(cells[0].state, 'past');
  assert.equal(cells[4].state, 'free', '12:00 is the current hour');
  assert.equal(cells[5].state, 'busy');
  assert.equal(cells[6].state, 'selected');
  assert.equal(cells[6].conflict, true);
  assert.equal(cells[7].state, 'selected');
  assert.equal(stripCells('2026-10-02', [], null, () => false, true).length, 24);
});
