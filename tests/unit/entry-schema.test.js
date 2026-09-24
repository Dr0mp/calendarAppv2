import '../setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EntryInput, normaliseEntry, entrySpan } from '../../shared/schemas/entry.js';
import { isEntryPast, canEditEntry, canDeleteEntry, canSeePrivate } from '../../shared/rules/permissions.js';
import { isShareLink, isHttpsUrl, isValidDate } from '../../shared/schemas/common.js';

const ev = {
  type: 'event', title: 'Atelier', space_id: '01900000-0000-7000-8000-000000000001',
  sessions: [{ date: '2026-10-01', start: '18:00', end: '20:00' }],
  enroll_url: 'https://example.com/x', cover_url: 'https://example.com/c.jpg', price_cents: null,
};

/** @param {any} v */
const codes = (v) => {
  const r = EntryInput.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
};

test('a valid event', () => assert.deepEqual(codes(ev), []));

test('event requirements', () => {
  assert.deepEqual(codes({ ...ev, space_id: null, enroll_url: '', cover_url: null }).sort(), ['cover:cover_required', 'enroll_url:required', 'space_id:required']);
  assert.deepEqual(codes({ ...ev, enroll_url: 'http://x.ro' }), ['enroll_url:invalid_https_url']);
  assert.deepEqual(codes({ ...ev, enroll_url: 'javascript:alert(1)' }), ['enroll_url:invalid_https_url']);
  assert.deepEqual(codes({ ...ev, price_cents: 7500 }), ['currency:required']);
  assert.deepEqual(codes({ ...ev, price_cents: 7500, currency: 'RON' }), []);
});

test('sessions: end after start, no overlap, 1–60, 24:00 allowed', () => {
  assert.deepEqual(codes({ ...ev, sessions: [] }), ['sessions:session_required']);
  assert.deepEqual(codes({ ...ev, sessions: [{ date: '2026-10-01', start: '20:00', end: '18:00' }] }), ['sessions.0.end:end_before_start']);
  assert.deepEqual(codes({ ...ev, sessions: [{ date: '2026-10-01', start: '22:00', end: '24:00' }] }), []);
  assert.deepEqual(codes({ ...ev, sessions: [{ date: '2026-10-01', start: '22:00', end: '24:30' }] }), ['sessions.0.end:invalid_time']);
  assert.deepEqual(
    codes({ ...ev, sessions: [{ date: '2026-10-01', start: '10:00', end: '12:00' }, { date: '2026-10-01', start: '11:00', end: '13:00' }] }),
    ['sessions.1.start:sessions_overlap'],
  );
  const many = Array.from({ length: 61 }, (_, i) => ({ date: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`, start: `${String(8 + Math.floor(i / 28) * 3).padStart(2, '0')}:00`, end: `${String(9 + Math.floor(i / 28) * 3).padStart(2, '0')}:00` }));
  assert.ok(codes({ ...ev, sessions: many }).includes('sessions:too_many_sessions'));
  assert.deepEqual(codes({ ...ev, sessions: [{ date: '2026-02-30', start: '10:00', end: '11:00' }] }), ['sessions.0.date:invalid_date']);
});

test('room-only and blocked rules', () => {
  const ro = { type: 'room_only', title: 'Oaspeți', sessions: [], room_bookings: [{ room_id: '01900000-0000-7000-8000-000000000002', check_in: '2026-10-01', check_out: '2026-10-01', guests: 1 }] };
  assert.deepEqual(codes(ro), ['room_bookings.0.check_out:checkout_before_checkin']);
  assert.deepEqual(codes({ ...ro, room_bookings: [] }), ['room_bookings:room_booking_required']);
  assert.deepEqual(codes({ type: 'blocked', title: 'Mentenanță', sessions: ev.sessions }), []);
  const r = EntryInput.safeParse({ ...ev, extra: 1 });
  assert.equal(r.success, false);
  assert.equal(r.error?.issues[0].code, 'unrecognized_keys');
});

test('normalise drops fields that do not apply', () => {
  const n = normaliseEntry(EntryInput.parse({ ...ev, type: 'blocked', price_cents: 100, currency: 'RON', price_note: 'x' }));
  assert.equal(n.price_cents, null);
  assert.equal(n.enroll_url, null);
  assert.equal(n.cover_url, null);
  const e = normaliseEntry(EntryInput.parse({ ...ev, sessions: [{ date: '2026-10-02', start: '10:00', end: '11:00' }, { date: '2026-10-01', start: '10:00', end: '11:00' }] }));
  assert.equal(e.sessions[0].date, '2026-10-01', 'sessions are sorted');
});

test('entry span includes bookings (check-out day excluded)', () => {
  assert.deepEqual(entrySpan({ sessions: [{ date: '2026-10-05' }], room_bookings: [{ check_in: '2026-10-04', check_out: '2026-10-07' }] }), { first: '2026-10-04', last: '2026-10-06' });
  assert.deepEqual(entrySpan({ sessions: [] }), { first: null, last: null });
});

test('permissions: owners edit until past; admins always; moderators own only', () => {
  const tz = 'Europe/Bucharest';
  const at = Date.parse('2026-10-01T15:30:00Z'); // 18:30 local
  const e = { owner_id: 'u1', type: 'event', sessions: [{ date: '2026-10-01', start: '17:00', end: '18:00' }] };
  const future = { ...e, sessions: [{ date: '2026-10-01', start: '19:00', end: '20:00' }] };
  assert.equal(isEntryPast(e, tz, at), true);
  assert.equal(isEntryPast(future, tz, at), false);
  assert.equal(isEntryPast({ ...e, sessions: [{ date: '2026-10-01', start: '22:00', end: '24:00' }] }, tz, at), false);
  assert.equal(isEntryPast({ ...e, sessions: [{ date: '2026-09-30', start: '22:00', end: '24:00' }] }, tz, at), true);
  assert.equal(isEntryPast({ type: 'room_only', sessions: [], room_bookings: [{ check_out: '2026-10-01' }] }, tz, at), true);
  assert.equal(isEntryPast({ type: 'room_only', sessions: [], room_bookings: [] }, tz, at), false);
  const user = { id: 'u1', role: 'user' };
  const mod = { id: 'm1', role: 'moderator' };
  const admin = { id: 'a1', role: 'admin' };
  assert.equal(canEditEntry(future, user, tz, at), true);
  assert.equal(canEditEntry(e, user, tz, at), false, 'past: admins only');
  assert.equal(canEditEntry(e, admin, tz, at), true);
  assert.equal(canEditEntry(future, mod, tz, at), false, 'moderators edit their own only');
  assert.equal(canEditEntry({ ...future, type: 'room_only' }, user, tz, at), false);
  assert.equal(canDeleteEntry(e, user), true, 'owners delete past entries');
  assert.equal(canDeleteEntry(e, mod), false);
  assert.equal(canDeleteEntry({ ...e, type: 'room_only' }, user), false);
  assert.equal(canDeleteEntry(e, admin), true);
  assert.equal(canSeePrivate(e, mod), true);
  assert.equal(canSeePrivate(e, { id: 'u2', role: 'user' }), false);
});

test('URL helpers', () => {
  assert.equal(isHttpsUrl('https://a.ro'), true);
  assert.equal(isHttpsUrl('data:text/html,x'), false);
  assert.equal(isHttpsUrl('notaurl'), false);
  assert.equal(isShareLink('\\\\server\\share\\folder'), true);
  assert.equal(isShareLink('http://drive.local/x'), true);
  assert.equal(isShareLink('javascript:alert(1)'), false);
  assert.equal(isShareLink('ftp://x'), false);
  assert.equal(isValidDate('2026-02-29'), false);
  assert.equal(isValidDate('2028-02-29'), true);
  assert.equal(isValidDate('2026-13-01'), false);
});
