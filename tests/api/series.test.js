import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './harness.js';
import { addDays, todayIn, weekdayOf } from '../../shared/rules/time.js';

/** @type {Awaited<ReturnType<typeof startApp>>} */
let t;
/** @type {any} */ let admin;
/** @type {any} */ let user;
/** @type {any} */ let mod;
/** @type {string} */ let hall;
/** @type {string} */ let room;
/** @type {string} */ let base;

before(async () => {
  t = await startApp();
  admin = await t.as('admin', 's.admin');
  user = await t.as('user', 's.user');
  mod = await t.as('moderator', 's.mod');
  hall = (await admin.get('/spaces')).data.items[0].id;
  room = (await admin.get('/rooms')).data.items[0].id;
  // A Monday about three months ahead, so weekly dates are predictable.
  let d = addDays(todayIn('Europe/Bucharest'), 90);
  while (weekdayOf(d) !== 1) d = addDays(d, 1);
  base = d;
});
after(() => t.close());

const d = (n) => addDays(base, n);
const blocked = (date, over = {}) => ({ type: 'blocked', title: 'Curs săptămânal', space_id: hall, sessions: [{ date, start: '10:00', end: '12:00' }], ...over });

describe('create and preview', () => {
  test('preview lists dates with conflict flags; skipped dates are marked', async () => {
    await admin.post('/entries', { entry: blocked(d(14), { title: 'Ocupat' }) });
    const r = await user.post('/series/preview', { type: 'blocked', rule: { freq: 'weekly', count: 4 }, sessions: [{ date: d(0), start: '10:00', end: '12:00' }], spaceId: hall, exceptions: [d(7)] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.dates.map((/** @type {any} */ x) => [x.date, x.conflict, x.skipped]), [
      [d(0), false, false], [d(7), false, true], [d(14), true, false], [d(21), false, false],
    ]);
    assert.equal(r.data.dates[2].conflicts[0].title, 'Ocupat');
    const bad = await user.post('/series/preview', { rule: { freq: 'weekly' }, sessions: [{ date: d(0), start: '10:00', end: '12:00' }] });
    assert.equal(bad.data.error, 'rule_end_required');
  });

  test('a series with a conflicting date fails as a whole, listing the dates', async () => {
    const r = await user.post('/entries', { entry: blocked(d(0)), recurrence: { rule: { freq: 'weekly', count: 4 } } });
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'space_conflict');
    assert.deepEqual(r.data.error.details.dates, [d(14)]);
    assert.equal((await user.get(`/entries?from=${d(0)}&to=${d(30)}&owner=me`)).data.items.length, 0, 'nothing was created');
  });

  test('skipping the conflicting date creates the rest', async () => {
    const r = await user.post('/entries', { entry: blocked(d(0)), recurrence: { rule: { freq: 'weekly', count: 4 }, exceptions: [d(14)] } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.created, 3);
    const s = await user.get(`/series/${r.data.series_id}`);
    assert.deepEqual(s.data.occurrences.map((/** @type {any} */ o) => o.date), [d(0), d(7), d(21)]);
    assert.deepEqual(s.data.exceptions, [d(14)]);
    const e = (await user.get(`/entries/${r.data.id}`)).data;
    assert.equal(e.series_total, 3);
    assert.equal(e.occurrence_index, 0);
  });

  test('admins can override space conflicts in a series', async () => {
    const r = await admin.post('/entries', { entry: blocked(d(14), { title: 'Peste', allow_overlap: true, sessions: [{ date: d(14), start: '11:00', end: '11:30' }] }), recurrence: { rule: { freq: 'weekly', count: 2 } } });
    assert.equal(r.status, 201);
  });

  test('monthly rules and validation', async () => {
    const r = await user.post('/entries', { entry: blocked(d(35), { space_id: null, title: 'Lunar', sessions: [{ date: d(35), start: '20:00', end: '21:00' }] }), recurrence: { rule: { freq: 'monthly_weekday', count: 3 } } });
    assert.equal(r.status, 201);
    const v = await user.post('/entries', { entry: blocked(d(40)), recurrence: { rule: { freq: 'weekly', count: 1 } } });
    assert.equal(v.status, 400);
    const multi = await user.post('/entries', { entry: blocked(d(40), { sessions: [{ date: d(40), start: '10:00', end: '11:00' }, { date: d(41), start: '10:00', end: '11:00' }] }), recurrence: { rule: { freq: 'weekly', count: 2 } } });
    assert.equal(multi.data.error.details.fields.recurrence, 'recurrence_multiday');
  });

  test('room bookings are shifted per occurrence and conflict-checked', async () => {
    const r = await mod.post('/entries', {
      entry: { type: 'event', title: 'Atelier cu cazare', space_id: hall, sessions: [{ date: d(50), start: '09:00', end: '10:00' }], enroll_url: 'https://x.ro/a', cover_url: 'https://x.ro/c.jpg', price_cents: null,
        room_bookings: [{ room_id: room, check_in: d(49), check_out: d(51), guests: 1 }] },
      recurrence: { rule: { freq: 'weekly', count: 3 } },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const s = (await mod.get(`/series/${r.data.series_id}`)).data;
    const second = (await mod.get(`/entries/${s.occurrences[1].id}`)).data;
    assert.deepEqual([second.room_bookings[0].check_in, second.room_bookings[0].check_out], [d(56), d(58)]);
    // A booking that overlaps the third occurrence's shifted room fails the whole series.
    await mod.post('/entries', { entry: { type: 'room_only', title: 'Blochează', sessions: [], room_bookings: [{ room_id: room, check_in: d(72), check_out: d(73), guests: 1 }] } });
    const clash = await mod.post('/entries', {
      entry: { type: 'blocked', title: 'Alt atelier', space_id: null, sessions: [{ date: d(57), start: '07:00', end: '07:30' }], room_bookings: [{ room_id: room, check_in: d(58), check_out: d(59), guests: 1 }] },
      recurrence: { rule: { freq: 'weekly', count: 3 } },
    });
    assert.equal(clash.data.error.code, 'room_conflict');
    assert.deepEqual(clash.data.error.details.dates, [d(71)]);
  });
});

describe('edit and delete scopes', () => {
  /** @returns {Promise<any[]>} occurrences of a fresh 4-week series */
  async function fresh(title, offset) {
    const r = await user.post('/entries', { entry: blocked(d(offset), { title, space_id: null, sessions: [{ date: d(offset), start: '18:00', end: '19:00' }] }), recurrence: { rule: { freq: 'weekly', count: 4 } } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const s = (await user.get(`/series/${r.data.series_id}`)).data;
    return Promise.all(s.occurrences.map(async (/** @type {any} */ o) => (await user.get(`/entries/${o.id}`)).data));
  }

  test('only this: detaches the entry and marks its date as an exception', async () => {
    const occ = await fresh('Doar una', 100);
    const target = occ[1];
    const r = await user.req('PATCH', `/entries/${target.id}?scope=one`, { body: blocked(target.sessions[0].date, { title: 'Mutată', space_id: null, sessions: [{ date: target.sessions[0].date, start: '19:00', end: '20:00' }] }), version: target.version });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.series_id, null);
    assert.equal(r.data.title, 'Mutată');
    const s = (await user.get(`/series/${occ[0].series_id}`)).data;
    assert.equal(s.occurrences.length, 3);
    assert.deepEqual(s.exceptions, [target.sessions[0].date]);
    assert.equal((await user.get(`/entries/${occ[2].id}`)).data.title, 'Doar una');
  });

  test('this and following: splits the series; earlier sessions are untouched', async () => {
    const occ = await fresh('Urmatoarele', 130);
    const target = occ[2];
    const body = blocked(target.sessions[0].date, { title: 'Nou orar', space_id: null, sessions: [{ date: target.sessions[0].date, start: '17:00', end: '18:30' }] });
    const r = await user.req('PATCH', `/entries/${target.id}?scope=following`, { body, version: target.version });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const after = await Promise.all(occ.map(async (o) => (await user.get(`/entries/${o.id}`)).data));
    assert.deepEqual(after.map((e) => [e.title, e.sessions[0].start]), [
      ['Urmatoarele', '18:00'], ['Urmatoarele', '18:00'], ['Nou orar', '17:00'], ['Nou orar', '17:00'],
    ]);
    assert.notEqual(after[2].series_id, after[0].series_id, 'split into a new series');
    assert.equal(after[3].series_id, after[2].series_id);
    assert.deepEqual([after[0].series_total, after[2].series_total], [2, 2]);
  });

  test('whole series: every non-past occurrence moves by the same offset; past ones are untouched', async () => {
    const occ = await fresh('Toata', 160);
    // Make the first occurrence past.
    const db = t.app.workspaces.main.db;
    db.prepare("UPDATE entry_sessions SET date = '2020-01-06' WHERE entry_id = ?").run(occ[0].id);
    db.prepare("UPDATE entries SET first_date = '2020-01-06', last_date = '2020-01-06' WHERE id = ?").run(occ[0].id);
    const target = occ[1];
    const moved = addDays(target.sessions[0].date, 1);
    const r = await user.req('PATCH', `/entries/${target.id}?scope=all`, {
      body: blocked(moved, { title: 'Marți acum', space_id: null, sessions: [{ date: moved, start: '18:00', end: '19:00' }] }),
      version: target.version,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const after = await Promise.all(occ.map(async (o) => (await user.get(`/entries/${o.id}`)).data));
    assert.equal(after[0].title, 'Toata', 'past occurrence untouched');
    assert.equal(after[0].sessions[0].date, '2020-01-06');
    assert.deepEqual(after.slice(1).map((e) => e.sessions[0].date), [addDays(occ[1].sessions[0].date, 1), addDays(occ[2].sessions[0].date, 1), addDays(occ[3].sessions[0].date, 1)]);
    assert.ok(after.slice(1).every((e) => e.title === 'Marți acum'));
  });

  test('a scoped edit that conflicts rolls back every occurrence', async () => {
    const occ = await fresh('Atomic', 200);
    await admin.post('/entries', { entry: blocked(occ[3].sessions[0].date, { title: 'Obstacol', space_id: hall, sessions: [{ date: occ[3].sessions[0].date, start: '20:00', end: '21:00' }] }) });
    const r = await user.req('PATCH', `/entries/${occ[0].id}?scope=all`, {
      body: blocked(occ[0].sessions[0].date, { title: 'Mai târziu', space_id: hall, sessions: [{ date: occ[0].sessions[0].date, start: '20:00', end: '21:00' }] }),
      version: occ[0].version,
    });
    assert.equal(r.status, 409);
    assert.deepEqual(r.data.error.details.dates, [occ[3].sessions[0].date]);
    const after = await Promise.all(occ.map(async (o) => (await user.get(`/entries/${o.id}`)).data));
    assert.ok(after.every((e) => e.title === 'Atomic' && e.sessions[0].start === '18:00'));
  });

  test('delete scopes: one (exception), following, all (past kept)', async () => {
    const occ = await fresh('Sterge', 230);
    let r = await user.req('DELETE', `/entries/${occ[1].id}?scope=one`, { version: occ[1].version });
    assert.equal(r.data.deleted, 1);
    let s = (await user.get(`/series/${occ[0].series_id}`)).data;
    assert.deepEqual(s.exceptions, [occ[1].sessions[0].date]);
    r = await user.req('DELETE', `/entries/${occ[2].id}?scope=following`, { version: occ[2].version });
    assert.equal(r.data.deleted, 2);
    s = (await user.get(`/series/${occ[0].series_id}`)).data;
    assert.equal(s.occurrences.length, 1);

    const occ2 = await fresh('Sterge tot', 260);
    const db = t.app.workspaces.main.db;
    db.prepare("UPDATE entry_sessions SET date = '2020-01-06' WHERE entry_id = ?").run(occ2[0].id);
    db.prepare("UPDATE entries SET first_date = '2020-01-06', last_date = '2020-01-06' WHERE id = ?").run(occ2[0].id);
    r = await user.req('DELETE', `/entries/${occ2[2].id}?scope=all`, { version: occ2[2].version });
    assert.equal(r.data.deleted, 3);
    assert.equal((await user.get(`/entries/${occ2[0].id}`)).status, 200, 'the past occurrence remains');
  });

  test('scopes respect permissions and If-Match', async () => {
    const occ = await fresh('Permisiuni', 290);
    const other = await t.as('user', 's.other');
    assert.equal((await other.req('DELETE', `/entries/${occ[0].id}?scope=all`, { version: occ[0].version })).status, 403);
    assert.equal((await user.req('DELETE', `/entries/${occ[0].id}?scope=all`, { version: 99 })).status, 409);
    const ra = await admin.post(`/entries/${occ[1].id}/reassign`, { ownerId: other.user.id, scope: 'following' });
    assert.equal(ra.status, 200);
    assert.equal((await user.get(`/entries/${occ[3].id}`)).data.owner.id, other.user.id);
    assert.equal((await user.get(`/entries/${occ[0].id}`)).data.owner.id, user.user.id);
  });
});
