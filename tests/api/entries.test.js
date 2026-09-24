import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client } from './harness.js';
import { addDays, todayIn } from '../../shared/rules/time.js';

/** @type {Awaited<ReturnType<typeof startApp>>} */
let t;
/** @type {any} */ let admin;
/** @type {any} */ let user;
/** @type {any} */ let user2;
/** @type {any} */ let mod;
/** @type {string} */ let hall;
/** @type {string} */ let studio;
/** @type {string} */ let room1;
/** @type {string} */ let room2;
/** @type {string} */ let base;

before(async () => {
  t = await startApp();
  admin = await t.as('admin', 'e.admin');
  user = await t.as('user', 'e.user');
  user2 = await t.as('user', 'e.user2');
  mod = await t.as('moderator', 'e.mod');
  const spaces = (await admin.get('/spaces')).data.items;
  hall = spaces[0].id;
  studio = spaces[1].id;
  const rooms = (await admin.get('/rooms')).data.items;
  room1 = rooms[0].id;
  room2 = rooms[1].id;
  base = addDays(todayIn('Europe/Bucharest'), 60);
});
after(() => t.close());

const d = (n) => addDays(base, n);
const event = (over = {}) => ({
  type: 'event',
  title: 'Atelier de ceramică',
  description: 'Descriere publică',
  space_id: hall,
  sessions: [{ date: d(0), start: '18:00', end: '20:00' }],
  price_cents: 7500,
  currency: 'RON',
  price_note: 'reducere studenți',
  enroll_url: 'https://example.com/inscriere',
  cover_url: 'https://example.com/cover.jpg',
  ...over,
});

describe('create', () => {
  test('an event with three sessions', async () => {
    const r = await user.post('/entries', {
      entry: event({ sessions: [{ date: d(2), start: '10:00', end: '12:00' }, { date: d(1), start: '10:00', end: '12:00' }, { date: d(1), start: '14:00', end: '16:00' }] }),
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.sessions.length, 3);
    assert.equal(r.data.sessions[0].date, d(1), 'sorted');
    assert.equal(r.data.first_date, d(1));
    assert.equal(r.data.last_date, d(2));
    assert.equal(r.data.owner.id, user.user.id);
    assert.equal(r.data.promotion_status, undefined, 'promotion status is for admins');
    assert.equal(r.data.can_edit, true);
    const again = await admin.get(`/entries/${r.data.id}`);
    assert.equal(again.data.promotion_status, 'pending');
    assert.equal(again.headers.get('etag'), 'W/"1"');
  });

  test('validation and past sessions', async () => {
    const bad = await user.post('/entries', { entry: event({ space_id: null, enroll_url: '' }) });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error.details.fields.space_id, 'required');
    assert.equal(bad.data.error.details.fields.enroll_url, 'required');
    const http = await user.post('/entries', { entry: event({ enroll_url: 'http://x.ro' }) });
    assert.equal(http.data.error.details.fields.enroll_url, 'invalid_https_url');
    const past = await user.post('/entries', { entry: event({ sessions: [{ date: addDays(base, -90), start: '10:00', end: '11:00' }] }) });
    assert.equal(past.data.error.details.fields['sessions.0.start'], 'in_the_past');
    const owner = await user.post('/entries', { entry: { ...event(), owner_id: admin.user.id } });
    assert.equal(owner.status, 400, 'owners cannot be forged');
  });

  test('only staff book rooms', async () => {
    const ro = { type: 'room_only', title: 'Oaspeți', sessions: [], room_bookings: [{ room_id: room1, check_in: d(3), check_out: d(5), guests: 2, guest_names: 'Ion și Maria' }] };
    assert.equal((await user.post('/entries', { entry: ro })).data.error.code, 'rooms_staff_only');
    assert.equal((await user.post('/entries', { entry: event({ sessions: [{ date: d(3), start: '09:00', end: '10:00' }], room_bookings: ro.room_bookings }) })).status, 403);
    const ok = await mod.post('/entries', { entry: ro });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.first_date, d(3));
    assert.equal(ok.data.last_date, d(4));
  });
});

describe('conflicts', () => {
  test('event vs event in the same space is blocked; other spaces are fine', async () => {
    const a = await user.post('/entries', { entry: event({ sessions: [{ date: d(10), start: '18:00', end: '20:00' }] }) });
    assert.equal(a.status, 201);
    const b = await user2.post('/entries', { entry: event({ sessions: [{ date: d(10), start: '19:00', end: '21:00' }] }) });
    assert.equal(b.status, 409);
    assert.equal(b.data.error.code, 'space_conflict');
    const c = b.data.error.details.conflicts[0];
    assert.equal(c.id, a.data.id);
    assert.equal(c.title, 'Atelier de ceramică');
    assert.equal(c.owner, 'e.user');
    assert.equal(b.data.error.details.canOverride, false);
    assert.equal((await user2.post('/entries', { entry: event({ space_id: studio, sessions: [{ date: d(10), start: '19:00', end: '21:00' }] }) })).status, 201);
    assert.equal((await user2.post('/entries', { entry: event({ sessions: [{ date: d(10), start: '20:00', end: '21:00' }] }) })).status, 201, 'touching is fine');
    // allow_overlap from a non-admin is ignored
    assert.equal((await user2.post('/entries', { entry: event({ allow_overlap: true, sessions: [{ date: d(10), start: '19:00', end: '19:30' }] }) })).status, 409);
  });

  test('admins can override space conflicts; the override is recorded', async () => {
    const r = await admin.post('/entries', { entry: event({ allow_overlap: true, sessions: [{ date: d(10), start: '18:30', end: '19:30' }] }) });
    assert.equal(r.status, 201);
    assert.equal(r.data.allow_overlap, true);
    const log = /** @type {any} */ (t.app.workspaces.main.db.prepare("SELECT * FROM audit_log WHERE action = 'allow_overlap' AND entity_id = ?").get(r.data.id));
    assert.ok(log);
    assert.equal(log.user_id, admin.user.id);
  });

  test('blocked slots block; a whole-venue block blocks every space', async () => {
    const blk = await user.post('/entries', { entry: { type: 'blocked', title: 'Mentenanță', description: 'Notă privată', space_id: null, sessions: [{ date: d(12), start: '08:00', end: '12:00' }] } });
    assert.equal(blk.status, 201);
    const e1 = await user2.post('/entries', { entry: event({ space_id: studio, sessions: [{ date: d(12), start: '11:00', end: '13:00' }] }) });
    assert.equal(e1.data.error.code, 'space_conflict');
    assert.equal(e1.data.error.details.conflicts[0].kind, 'blocked');
    const ev = await user2.post('/entries', { entry: event({ sessions: [{ date: d(13), start: '10:00', end: '11:00' }] }) });
    const blk2 = await user.post('/entries', { entry: { type: 'blocked', title: 'Privat', space_id: hall, sessions: [{ date: d(13), start: '10:30', end: '12:00' }] } });
    assert.equal(ev.status, 201);
    assert.equal(blk2.data.error.code, 'space_conflict', 'a new block over an existing event');
  });

  test('room conflicts are always blocked, with hotel semantics', async () => {
    const first = await mod.post('/entries', { entry: { type: 'room_only', title: 'A', sessions: [], room_bookings: [{ room_id: room2, check_in: d(20), check_out: d(22), guests: 1 }] } });
    assert.equal(first.status, 201);
    const clash = await admin.post('/entries', { entry: { type: 'room_only', title: 'B', allow_overlap: true, sessions: [], room_bookings: [{ room_id: room2, check_in: d(21), check_out: d(23), guests: 1 }] } });
    assert.equal(clash.status, 409);
    assert.equal(clash.data.error.code, 'room_conflict');
    const next = await admin.post('/entries', { entry: { type: 'room_only', title: 'C', sessions: [], room_bookings: [{ room_id: room2, check_in: d(22), check_out: d(23), guests: 1 }] } });
    assert.equal(next.status, 201, 'check-out day is free');
    const self = await admin.post('/entries', {
      entry: { type: 'room_only', title: 'D', sessions: [], room_bookings: [{ room_id: room1, check_in: d(30), check_out: d(32), guests: 1 }, { room_id: room1, check_in: d(31), check_out: d(33), guests: 1 }] },
    });
    assert.equal(self.data.error.code, 'room_conflict', 'rows of one form are checked against each other');
  });

  test('availability: conflicts, suggestions, busy intervals and the same-day note', async () => {
    const r = await user2.post('/availability', { type: 'event', spaceId: hall, sessions: [{ date: d(10), start: '19:00', end: '20:00' }], dates: [d(11)] });
    assert.equal(r.status, 200);
    assert.ok(r.data.conflicts.length >= 1);
    const s = r.data.suggestions[0];
    assert.deepEqual(s.session, { date: d(10), start: '19:00', end: '20:00' });
    assert.deepEqual(s.options.map((/** @type {any} */ o) => o.kind), ['same_day', 'next_free_day', 'next_week']);
    assert.equal(s.options[0].session.start, '08:00');
    assert.ok(r.data.busy[d(10)].length >= 2);
    assert.deepEqual(r.data.busy[d(11)], []);
    assert.ok(r.data.sameDayOther[d(10)].some((/** @type {any} */ e) => e.space_id === studio));
    assert.equal((await user.post('/availability', { type: 'room_only', sessions: [], rooms: [{ room_id: room2, check_in: d(21), check_out: d(22) }] })).status, 403);
    const rooms = await mod.post('/availability', { type: 'room_only', sessions: [], rooms: [{ room_id: room2, check_in: d(21), check_out: d(22) }] });
    assert.equal(rooms.data.roomConflicts.length, 1);
  });
});

describe('read and redaction', () => {
  test('others see blocked slots without notes and room bookings without guests or titles', async () => {
    const r = await user2.get('/entries', { headers: {} });
    assert.equal(r.status, 400, 'from/to required');
    const list = (await user2.get(`/entries?from=${d(0)}&to=${d(40)}`)).data.items;
    const blk = list.find((/** @type {any} */ e) => e.type === 'blocked' && e.owner.id === user.user.id);
    assert.equal(blk.description, null);
    assert.equal(blk.title, 'Mentenanță');
    const ro = list.find((/** @type {any} */ e) => e.type === 'room_only');
    assert.equal(ro.title, null);
    assert.equal(ro.room_bookings[0].guest_names, undefined);
    assert.equal(ro.room_bookings[0].guests, undefined);
    assert.ok(ro.room_bookings[0].room_name);
    const own = (await user.get(`/entries?from=${d(0)}&to=${d(40)}`)).data.items.find((/** @type {any} */ e) => e.id === blk.id);
    assert.equal(own.description, 'Notă privată');
    const staff = (await mod.get(`/entries/${blk.id}`)).data;
    assert.equal(staff.description, 'Notă privată');
  });

  test('search never matches redacted fields', async () => {
    const hidden = await user2.get(`/entries?from=${d(0)}&to=${d(40)}&q=${encodeURIComponent('notă privată')}`);
    assert.equal(hidden.data.items.length, 0);
    const guests = await user2.get(`/entries?from=${d(0)}&to=${d(40)}&q=maria`);
    assert.equal(guests.data.items.length, 0);
    const visible = await mod.get(`/entries?from=${d(0)}&to=${d(40)}&q=${encodeURIComponent('nota privata')}`);
    assert.equal(visible.data.items.length, 1, 'diacritics-insensitive');
    const byOwner = await user2.get(`/entries?from=${d(0)}&to=${d(40)}&q=e.user2`);
    assert.ok(byOwner.data.items.length >= 1);
  });

  test('filters: type, space, owner=me', async () => {
    const onlyBlocked = await user.get(`/entries?from=${d(0)}&to=${d(40)}&type=blocked`);
    assert.ok(onlyBlocked.data.items.every((/** @type {any} */ e) => e.type === 'blocked'));
    const studioOnly = await user.get(`/entries?from=${d(0)}&to=${d(40)}&space=${studio}`);
    assert.ok(studioOnly.data.items.every((/** @type {any} */ e) => e.space_id === studio));
    const mine = await user.get('/entries?owner=me');
    assert.ok(mine.data.items.length >= 2);
    assert.ok(mine.data.items.every((/** @type {any} */ e) => e.owner.id === user.user.id));
  });
});

describe('edit, delete, reassign', () => {
  test('owners edit their own; others cannot; version conflicts', async () => {
    const c = await user.post('/entries', { entry: event({ sessions: [{ date: d(15), start: '10:00', end: '11:00' }] }) });
    const id = c.data.id;
    assert.equal((await user2.patch(`/entries/${id}`, event({ title: 'X' }), 1)).status, 403);
    assert.equal((await mod.patch(`/entries/${id}`, event({ title: 'X' }), 1)).status, 403);
    const ok = await user.patch(`/entries/${id}`, event({ title: 'Nou', sessions: [{ date: d(15), start: '11:00', end: '12:00' }] }), 1);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.version, 2);
    assert.equal(ok.data.sessions[0].start, '11:00');
    const stale = await user.patch(`/entries/${id}`, event({ title: 'Vechi' }), 1);
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error.code, 'version_conflict');
    assert.equal(stale.data.error.details.current, 2);
    // Type change keeps what applies and clears promotion
    const blocked = await user.patch(`/entries/${id}`, { type: 'blocked', title: 'Nou', sessions: ok.data.sessions }, 2);
    assert.equal(blocked.status, 200);
    assert.equal((await admin.get(`/entries/${id}`)).data.promotion_status, null);
    assert.equal(blocked.data.price_cents, null);
  });

  test('non-staff cannot change bookings; staff replace them on any entry', async () => {
    const c = await admin.post('/entries', { entry: event({ sessions: [{ date: d(16), start: '10:00', end: '11:00' }], room_bookings: [{ room_id: room1, check_in: d(16), check_out: d(17), guests: 1 }] }) });
    assert.equal(c.status, 201);
    await admin.post(`/entries/${c.data.id}/reassign`, { ownerId: user.user.id });
    const v = (await user.get(`/entries/${c.data.id}`)).data;
    // omitted bookings are kept
    const keep = await user.patch(`/entries/${c.data.id}`, event({ sessions: [{ date: d(16), start: '10:00', end: '11:30' }] }), v.version);
    assert.equal(keep.status, 200);
    assert.equal(keep.data.room_bookings.length, 1);
    const change = await user.patch(`/entries/${c.data.id}`, event({ sessions: keep.data.sessions, room_bookings: [] }), keep.data.version);
    assert.equal(change.data.error.code, 'rooms_staff_only');
    assert.equal((await user.put(`/entries/${c.data.id}/room-bookings`, { room_bookings: [] }, keep.data.version)).status, 403);
    const put = await mod.put(`/entries/${c.data.id}/room-bookings`, { room_bookings: [{ room_id: room2, check_in: d(16), check_out: d(18), guests: 3, guest_names: 'Trainer' }] }, keep.data.version);
    assert.equal(put.status, 200);
    assert.equal(put.data.room_bookings[0].room_id, room2);
    assert.equal(put.data.last_date, d(17));
  });

  test('delete: owner or admin', async () => {
    const c = await user.post('/entries', { entry: event({ sessions: [{ date: d(18), start: '10:00', end: '11:00' }] }) });
    assert.equal((await user2.del(`/entries/${c.data.id}`, 1)).status, 403);
    assert.equal((await mod.del(`/entries/${c.data.id}`, 1)).status, 403);
    assert.equal((await user.del(`/entries/${c.data.id}`, 1)).status, 200);
    assert.equal((await user.get(`/entries/${c.data.id}`)).status, 404);
  });

  test('past entries: admins edit; owners only delete', async () => {
    const db = t.app.workspaces.main.db;
    const c = await user.post('/entries', { entry: event({ sessions: [{ date: d(19), start: '10:00', end: '11:00' }] }) });
    db.prepare("UPDATE entry_sessions SET date = '2020-01-01' WHERE entry_id = ?").run(c.data.id);
    db.prepare("UPDATE entries SET first_date = '2020-01-01', last_date = '2020-01-01' WHERE id = ?").run(c.data.id);
    const v = (await user.get(`/entries/${c.data.id}`)).data;
    assert.equal(v.past, true);
    assert.equal(v.can_edit, false);
    assert.equal((await user.patch(`/entries/${c.data.id}`, event({ sessions: v.sessions }), 1)).data.error.code, 'past_entry_admin_only');
    assert.equal((await admin.patch(`/entries/${c.data.id}`, event({ title: 'Corectat', sessions: v.sessions }), 1)).status, 200);
    assert.equal((await user.del(`/entries/${c.data.id}`, 2)).status, 200);
  });

  test('reassign: admin only; ownership by id', async () => {
    const c = await user.post('/entries', { entry: event({ sessions: [{ date: d(24), start: '10:00', end: '11:00' }] }) });
    assert.equal((await user.post(`/entries/${c.data.id}/reassign`, { ownerId: user2.user.id })).status, 403);
    const r = await admin.post(`/entries/${c.data.id}/reassign`, { ownerId: user2.user.id });
    assert.equal(r.data.owner.id, user2.user.id);
    assert.equal((await user.patch(`/entries/${c.data.id}`, event({ sessions: c.data.sessions }), r.data.version)).status, 403);
  });

  test('my counts', async () => {
    const r = await user2.get('/me/counts');
    assert.ok(r.data.myUpcoming >= 2);
    assert.equal(r.data.promotions, 0);
    assert.ok((await admin.get('/me/counts')).data.promotions >= 1);
  });
});

describe('demo isolation (flow 10, entries)', () => {
  test('demo sessions see only demo data; a reset restores the seed', async () => {
    const demo = new Client(t.http, '10.20.0.1');
    await demo.demo('demo');
    const from = todayIn('Europe/Bucharest');
    const to = addDays(from, 40);
    const seeded = (await demo.get(`/entries?from=${from}&to=${to}`)).data.items;
    assert.ok(seeded.length >= 5);
    const demoSpaces = (await demo.get('/spaces')).data.items;
    assert.ok(demoSpaces.every((/** @type {any} */ s) => s.id !== hall), 'separate datasets');
    const created = await demo.post('/entries', {
      entry: event({ space_id: demoSpaces[1].id, title: 'Demo nou', sessions: [{ date: addDays(from, 35), start: '10:00', end: '11:00' }] }),
    });
    assert.equal(created.status, 201);
    assert.equal((await user.get(`/entries/${created.data.id}`)).status, 404, 'main cannot read demo');
    const mainEntry = (await user.get('/entries?owner=me')).data.items[0];
    assert.equal((await demo.get(`/entries/${mainEntry.id}`)).status, 404, 'demo cannot read main');
    assert.ok(!(await demo.get(`/entries?from=${from}&to=${addDays(from, 120)}`)).data.items.some((/** @type {any} */ e) => e.owner.id === user.user.id));
    // owners in the demo are seed users, never real ones
    const owners = new Set(seeded.map((/** @type {any} */ e) => e.owner.name));
    assert.ok(![...owners].includes('e.user'));

    t.app.resetDemo();
    const after = (await demo.get(`/entries?from=${from}&to=${to}`)).data.items;
    assert.equal(after.length, seeded.length);
    assert.ok(!after.some((/** @type {any} */ e) => e.title === 'Demo nou'));
  });
});
