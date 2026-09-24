import '../setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemsByDate, layoutColumns, matches, fold, applyFilters, countInMonth } from '../../shared/rules/calendar.js';

const E = (id, over = {}) => ({
  id, type: 'event', title: id, description: null, space_id: 'A', space: { name: 'Sala Mare' }, owner: { id: 'u1', name: 'Ana Ionescu' },
  sessions: [], room_bookings: [], first_date: '2026-10-01', last_date: '2026-10-01', ...over,
});

test('items per date: sessions on each day, room-only stays per night', () => {
  const m = itemsByDate([
    E('multi', { sessions: [{ date: '2026-10-01', start: '18:00', end: '20:00' }, { date: '2026-10-02', start: '09:00', end: '10:00' }] }),
    E('stay', { type: 'room_only', room_bookings: [{ room_id: 'R', check_in: '2026-10-01', check_out: '2026-10-03' }] }),
    E('ev-with-room', { sessions: [{ date: '2026-10-05', start: '10:00', end: '11:00' }], room_bookings: [{ room_id: 'R', check_in: '2026-10-05', check_out: '2026-10-06' }] }),
  ]);
  assert.deepEqual(m.get('2026-10-01')?.map((i) => [i.entry.id, i.kind]), [['stay', 'stay'], ['multi', 'session']]);
  assert.deepEqual(m.get('2026-10-02')?.map((i) => i.entry.id), ['stay', 'multi']);
  assert.equal(m.get('2026-10-03'), undefined, 'check-out day is free');
  assert.deepEqual(m.get('2026-10-05')?.map((i) => i.kind), ['session'], 'event bookings are not drawn as stays');
});

test('overlapping sessions sit side by side', () => {
  const it = (id, start, end) => ({ entry: { id }, kind: 'session', date: 'd', start, end, key: id });
  const out = layoutColumns([it('a', '10:00', '12:00'), it('b', '11:00', '13:00'), it('c', '12:00', '14:00'), it('d', '15:00', '16:00')]);
  const by = Object.fromEntries(out.map((o) => [o.item.key, [o.col, o.cols]]));
  assert.deepEqual(by, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  const three = layoutColumns([it('x', '10:00', '11:00'), it('y', '10:00', '11:00'), it('z', '10:30', '11:30')]);
  assert.deepEqual(three.map((o) => o.cols), [3, 3, 3]);
});

test('search matches title, space, owner and guests, diacritics-insensitive', () => {
  const e = E('Atelier', { description: 'Pictură', room_bookings: [{ room_name: 'Camera 1', guest_names: 'Ștefan' }] });
  assert.equal(matches(e, fold('pictura')), true);
  assert.equal(matches(e, fold('sala mare')), true);
  assert.equal(matches(e, fold('ionescu')), true);
  assert.equal(matches(e, fold('stefan')), true);
  assert.equal(matches(e, fold('nimic')), false);
  assert.equal(matches(e, ''), true);
});

test('filters and counts that include spanning entries', () => {
  const list = [E('a'), E('b', { type: 'blocked', space_id: null, owner: { id: 'u2', name: 'B' } }), E('c', { space_id: 'B' })];
  assert.deepEqual(applyFilters(list, { types: ['event'], spaces: [], owner: '' }, 'u1').map((e) => e.id), ['a', 'c']);
  assert.deepEqual(applyFilters(list, { types: [], spaces: ['A'], owner: '' }, 'u1').map((e) => e.id), ['a']);
  assert.deepEqual(applyFilters(list, { types: [], spaces: [], owner: 'me' }, 'u2').map((e) => e.id), ['b']);
  assert.equal(applyFilters(list, { types: ['event'], spaces: [], owner: '' }, 'u1', 'types').length, 3);
  const span = E('span', { first_date: '2026-09-28', last_date: '2026-11-02' });
  assert.equal(countInMonth([span], '2026-10'), 1);
  assert.equal(countInMonth([span], '2026-12'), 0);
});
