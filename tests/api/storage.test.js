import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { startApp, Client } from './harness.js';
import { addDays, todayIn } from '../../shared/rules/time.js';
import { newId, isoNow } from '../../server/util.js';
import { csvCell } from '../../server/services/admin-entries.js';
import { pruneBackups, runNightlyBackup } from '../../server/services/backup.js';

/** @type {Awaited<ReturnType<typeof startApp>>} */
let t;
/** @type {any} */ let admin;
/** @type {any} */ let user;
const today = () => todayIn('Europe/Bucharest');

before(async () => {
  t = await startApp({ SEED_SAMPLE_CONTENT: '0' });
  admin = await t.as('admin', 'st.admin');
  user = await t.as('user', 'st.user');
});
after(() => t.close());

/** @param {number} w @param {number} h */
async function upload(w, h, seed = 1) {
  const data = await sharp({ create: { width: w, height: h, channels: 3, background: { r: seed * 13, g: 90, b: 40 } } }).png().toBuffer();
  const r = await admin.req('POST', '/api/v1/media', { raw: data, headers: { 'content-type': 'application/octet-stream', 'x-filename': `f${seed}.png` } });
  assert.equal(r.status, 201);
  return r.data;
}

/**
 * Insert an entry that is already over (the API refuses past dates).
 * @param {{daysAgo: number, type?: string, cover?: string|null, guests?: string|null, title?: string}} o
 */
function pastEntry(o) {
  const db = t.app.workspaces.main.db;
  const id = newId();
  const d = addDays(today(), -o.daysAgo);
  const now = isoNow();
  const type = o.type ?? 'event';
  db.prepare(
    `INSERT INTO entries (id, type, title, owner_id, owner_name_snapshot, cover_media_id, cover_url, enroll_url, promotion_status, first_date, last_date,
       created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, 'x', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, type, o.title ?? `Trecut ${o.daysAgo}`, user.user.id, o.cover ?? null, o.cover ? null : type === 'event' ? 'https://example.com/c.jpg' : null,
    type === 'event' ? 'https://example.com' : null, type === 'event' ? 'pending' : null, d, d, now, user.user.id, now, user.user.id);
  if (type === 'room_only') {
    const room = /** @type {any} */ (db.prepare('SELECT id FROM rooms LIMIT 1').get());
    db.prepare('INSERT INTO room_bookings (id, entry_id, room_id, check_in, check_out, guests, guest_names) VALUES (?, ?, ?, ?, ?, 1, ?)').run(
      newId(), id, room.id, addDays(d, -1), d, o.guests ?? null,
    );
  } else {
    db.prepare("INSERT INTO entry_sessions (id, entry_id, date, start_time, end_time, start_utc, end_utc) VALUES (?, ?, ?, '10:00', '11:00', ?, ?)").run(
      newId(), id, d, `${d}T07:00:00Z`, `${d}T08:00:00Z`,
    );
  }
  return id;
}

const exists = (/** @type {string} */ id) => !!t.app.workspaces.main.db.prepare('SELECT 1 FROM media WHERE id = ?').get(id);

describe('storage page', () => {
  test('breakdown adds up and the largest files show where they are used', async () => {
    const cover = await upload(1600, 900, 1);
    const orphan = await upload(800, 800, 2);
    pastEntry({ daysAgo: 200, cover: cover.id, title: 'Cu copertă' });
    const r = await admin.get('/storage');
    assert.equal(r.status, 200);
    const b = r.data.breakdown;
    assert.equal(b.covers + b.posts + b.other + b.unreferenced, r.data.mediaBytes);
    assert.equal(b.database, r.data.dbBytes);
    assert.ok(b.covers >= cover.bytes);
    assert.ok(b.unreferenced >= orphan.bytes);
    const big = r.data.largest.find((/** @type {any} */ m) => m.id === cover.id);
    assert.equal(big.usages.entries[0].title, 'Cu copertă');
    assert.equal(r.data.largest.find((/** @type {any} */ m) => m.id === orphan.id).unreferenced, true);
    assert.equal((await user.get('/storage')).status, 403);
  });
});

describe('cleanup tools', () => {
  test('past entries older than N days: the preview is exact and changes nothing', async () => {
    const cover = await upload(1600, 900, 3);
    const old = pastEntry({ daysAgo: 100, cover: cover.id });
    const recent = pastEntry({ daysAgo: 5 });
    const prev = await admin.post('/storage/cleanup/past-entries?dryRun=1', { olderThanDays: 90 });
    assert.equal(prev.status, 200);
    assert.equal(prev.data.dryRun, true);
    assert.ok(prev.data.count >= 1);
    assert.ok(prev.data.bytes >= cover.bytes + cover.thumb_bytes);
    assert.ok(t.app.workspaces.main.db.prepare('SELECT 1 FROM entries WHERE id = ?').get(old), 'preview keeps it');
    assert.equal(exists(cover.id), true, 'preview keeps the file');
    const run = await admin.post('/storage/cleanup/past-entries', { olderThanDays: 90 });
    assert.deepEqual({ count: run.data.count, bytes: run.data.bytes }, { count: prev.data.count, bytes: prev.data.bytes });
    assert.ok(!t.app.workspaces.main.db.prepare('SELECT 1 FROM entries WHERE id = ?').get(old));
    assert.ok(t.app.workspaces.main.db.prepare('SELECT 1 FROM entries WHERE id = ?').get(recent));
    assert.equal(exists(cover.id), false, 'the freed cover is deleted now');
  });

  test('covers of past events go; the events stay', async () => {
    const cover = await upload(1600, 900, 4);
    const id = pastEntry({ daysAgo: 3, cover: cover.id });
    const prev = await admin.post('/storage/cleanup/past-covers?dryRun=1', {});
    assert.ok(prev.data.count >= 1);
    assert.ok(prev.data.bytes >= cover.bytes + cover.thumb_bytes);
    const run = await admin.post('/storage/cleanup/past-covers', {});
    assert.deepEqual([run.data.count, run.data.bytes], [prev.data.count, prev.data.bytes]);
    const e = /** @type {any} */ (t.app.workspaces.main.db.prepare('SELECT cover_media_id, cover_url FROM entries WHERE id = ?').get(id));
    assert.deepEqual({ ...e }, { cover_media_id: null, cover_url: null });
    assert.equal(exists(cover.id), false);
  });

  test('media of old published posts; shared media is kept while still used', async () => {
    const a = await upload(1080, 1350, 5);
    const shared = await upload(1080, 1350, 6);
    const ig = (await admin.get('/platforms')).data.items.find((/** @type {any} */ p) => p.slug === 'instagram');
    const base = { platform_id: ig.id, format_id: ig.formats[1].id, publish_time: '10:00', status: 'published', title: 'P' };
    const old = await admin.post('/posts', { ...base, publish_date: addDays(today(), -40), media: [{ media_id: a.id }, { media_id: shared.id }] });
    assert.equal(old.status, 201, JSON.stringify(old.data));
    const fresh = await admin.post('/posts', { ...base, publish_date: addDays(today(), -2), media: [{ media_id: shared.id }] });
    assert.equal(fresh.status, 201);
    const prev = await admin.post('/storage/cleanup/post-media?dryRun=1', { olderThanDays: 30 });
    assert.equal(prev.data.count, 1);
    assert.equal(prev.data.bytes, a.bytes + a.thumb_bytes);
    await admin.post('/storage/cleanup/post-media', { olderThanDays: 30 });
    assert.equal((await admin.get(`/posts/${old.data.id}`)).data.media.length, 0);
    assert.equal(exists(a.id), false);
    assert.equal(exists(shared.id), true);
  });

  test('purge unreferenced now, any age', async () => {
    const m = await upload(300, 300, 7);
    const prev = await admin.post('/storage/cleanup/unreferenced?dryRun=1', {});
    assert.ok(prev.data.count >= 1);
    assert.ok(prev.data.bytes >= m.bytes);
    const run = await admin.post('/storage/cleanup/unreferenced', {});
    assert.equal(run.data.bytes, prev.data.bytes);
    assert.equal(exists(m.id), false);
    assert.equal((await admin.post('/storage/cleanup/unreferenced?dryRun=1', {})).data.count, 0);
  });

  test('guest names of bookings that ended more than N days ago', async () => {
    const old = pastEntry({ daysAgo: 60, type: 'room_only', guests: 'Ion Popescu' });
    const recent = pastEntry({ daysAgo: 2, type: 'room_only', guests: 'Maria Ionescu' });
    const prev = await admin.post('/storage/cleanup/guest-names?dryRun=1', { olderThanDays: 30 });
    assert.deepEqual({ count: prev.data.count, bytes: prev.data.bytes }, { count: 1, bytes: 0 });
    await admin.post('/storage/cleanup/guest-names', { olderThanDays: 30 });
    const names = (/** @type {string} */ id) => /** @type {any} */ (t.app.workspaces.main.db.prepare('SELECT guest_names FROM room_bookings WHERE entry_id = ?').get(id)).guest_names;
    assert.equal(names(old), null);
    assert.equal(names(recent), 'Maria Ionescu');
    assert.equal((await admin.post('/storage/cleanup/nope', {})).status, 400);
    assert.equal((await user.post('/storage/cleanup/unreferenced', {})).status, 403);
  });

  test('uploads are refused at the cap; deleting is always allowed', async () => {
    const t2 = await startApp({ SEED_SAMPLE_CONTENT: '0', STORAGE_CAP_GB: '0.0001' });
    try {
      const a = await t2.as('admin');
      const data = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#0f0' } }).png().toBuffer();
      const r = await a.req('POST', '/api/v1/media', { raw: data, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'x.png' } });
      assert.equal(r.status, 507);
      assert.equal(r.data.error.code, 'storage_full');
      assert.equal((await a.get('/storage')).data.level, 'full');
      assert.equal((await a.post('/storage/cleanup/unreferenced', {})).status, 200);
    } finally {
      t2.close();
    }
  });
});

describe('backups', () => {
  test('the download is a zip with both databases and the media folder', async () => {
    await upload(200, 200, 8);
    const r = await admin.get('/backup');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/zip');
    assert.match(r.headers.get('content-disposition'), /attachment; filename="backup-[\d-]+\.zip"/);
    const buf = Buffer.from(r.data);
    assert.equal(buf.readUInt32LE(0), 0x04034b50, 'zip signature');
    const names = buf.toString('latin1');
    for (const n of ['auth.db', 'main.db', 'backup.json', 'media/originals/']) assert.ok(names.includes(n), n);
    assert.ok(!fs.readdirSync(path.join(t.dataDir, 'tmp')).some((f) => f.startsWith('backup-')), 'snapshots are cleaned up');
  });

  test('the demo is never backed up; users are refused', async () => {
    const demo = new Client(t.http, '10.8.0.9');
    await demo.demo('demo_admin');
    assert.equal((await demo.get('/backup')).status, 403);
    assert.equal((await user.get('/backup')).status, 403);
  });

  test('nightly backup: snapshots open as SQLite; backups older than 7 days are pruned', async () => {
    const file = await runNightlyBackup(t.app);
    assert.ok(fs.existsSync(file));
    // The raw snapshot files are consistent databases.
    const dir = path.join(t.dataDir, 'snap-check');
    const { snapshot } = await import('../../server/services/backup.js');
    const s = snapshot(t.app, dir);
    const main = new DatabaseSync(s.main, { readOnly: true });
    assert.ok(/** @type {any} */ (main.prepare('SELECT COUNT(*) AS n FROM platforms').get()).n > 0);
    main.close();
    const auth = new DatabaseSync(s.auth, { readOnly: true });
    assert.ok(/** @type {any} */ (auth.prepare('SELECT COUNT(*) AS n FROM users').get()).n > 0);
    auth.close();

    const old = path.join(t.app.config.backupDir, 'backup-2000-01-01-00-00.zip');
    fs.writeFileSync(old, 'x');
    const tenDaysAgo = (Date.now() - 10 * 86400_000) / 1000;
    fs.utimesSync(old, tenDaysAgo, tenDaysAgo);
    pruneBackups(t.app.config.backupDir);
    assert.ok(!fs.existsSync(old));
    assert.ok(fs.existsSync(file));
  });
});

describe('all entries (audit)', () => {
  test('default range is from today on; filters, search and pages of 50', async () => {
    const spaces = (await admin.get('/spaces')).data.items;
    const base = { type: 'blocked', title: 'Audit', space_id: spaces[1].id };
    for (let i = 0; i < 55; i++) {
      const r = await user.post('/entries', { entry: { ...base, title: `Audit ${i}`, sessions: [{ date: addDays(today(), 100 + i), start: '08:00', end: '09:00' }] } });
      assert.equal(r.status, 201, JSON.stringify(r.data));
    }
    pastEntry({ daysAgo: 10, title: 'Audit din trecut' });
    const p1 = (await admin.get('/admin/entries?type=blocked&q=audit')).data;
    assert.equal(p1.total, 55);
    assert.equal(p1.items.length, 50);
    assert.equal(p1.pages, 2);
    assert.equal(p1.items[0].title, 'Audit 0');
    assert.equal(p1.items[0].owner.name, 'st.user');
    assert.deepEqual(p1.items[0].when, { date: addDays(today(), 100), start: '08:00', end: '09:00', sessions: 1 });
    assert.equal((await admin.get('/admin/entries?type=blocked&q=audit&page=2')).data.items.length, 5);
    const past = (await admin.get(`/admin/entries?from=${addDays(today(), -30)}&q=trecut`)).data;
    assert.equal(past.items[0].title, 'Audit din trecut');
    const owner = (await admin.get(`/admin/entries?owner=${admin.user.id}&type=blocked`)).data;
    assert.equal(owner.total, 0);
    assert.equal((await admin.get('/admin/entries?from=nope')).status, 400);
    assert.equal((await user.get('/admin/entries')).status, 403);
  });

  test('CSV export of the filtered list, safe against formula injection', async () => {
    await user.post('/entries', { entry: { type: 'blocked', title: '=HYPERLINK("x")', sessions: [{ date: addDays(today(), 90), start: '08:00', end: '09:00' }] } });
    const r = await admin.get('/admin/entries.csv?q=hyperlink');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    const text = Buffer.from(r.data).toString('utf8');
    assert.ok(text.startsWith('﻿Dată,Oră început'));
    const lines = text.trim().split('\r\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes(`"'=HYPERLINK(""x"")"`));
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('+40 700'), `"'+40 700"`);
    assert.equal(csvCell(null), '');
  });

  test('bulk reassign and delete', async () => {
    const mk = async (/** @type {number} */ d) =>
      (await user.post('/entries', { entry: { type: 'blocked', title: `Bulk ${d}`, sessions: [{ date: addDays(today(), d), start: '20:00', end: '21:00' }] } })).data;
    const a = await mk(60);
    const b = await mk(61);
    const ra = await admin.post('/admin/entries/bulk', { action: 'reassign', ids: [a.id ?? a.entry.id, b.id ?? b.entry.id], ownerId: admin.user.id });
    assert.equal(ra.status, 200, JSON.stringify(ra.data));
    assert.equal((await admin.get(`/admin/entries?owner=${admin.user.id}&q=bulk`)).data.total, 2);
    assert.equal((await admin.post('/admin/entries/bulk', { action: 'reassign', ids: [a.id ?? a.entry.id] })).status, 400);
    const del = await admin.post('/admin/entries/bulk', { action: 'delete', ids: [a.id ?? a.entry.id, b.id ?? b.entry.id] });
    assert.equal(del.data.count, 2);
    assert.equal((await admin.get('/admin/entries?q=bulk')).data.total, 0);
    assert.equal((await user.post('/admin/entries/bulk', { action: 'delete', ids: ['x'] })).status, 403);
  });
});
