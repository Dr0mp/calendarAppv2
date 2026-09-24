import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startApp, Client } from './harness.js';
import { importV1, formatReport } from '../../server/import/v1.js';

const FIX = path.join(import.meta.dirname, '../fixtures/v1');
const users = JSON.parse(fs.readFileSync(path.join(FIX, 'users.json'), 'utf8'));
const workspace = JSON.parse(fs.readFileSync(path.join(FIX, 'workspace.json'), 'utf8'));
const uploadsDir = path.join(FIX, 'uploads');

/** @type {Awaited<ReturnType<typeof startApp>>} */
let t;
before(async () => {
  t = await startApp({ SEED_SAMPLE_CONTENT: '0' });
});
after(() => t.close());

const db = () => t.app.workspaces.main.db;
/** @param {string} sql @param {...any} args */
const all = (sql, ...args) => /** @type {any[]} */ (db().prepare(sql).all(...args));
/** @param {string} title */
const entry = (title) => all('SELECT * FROM entries WHERE title = ? ORDER BY first_date', title);
/** @param {string} id */
const sessions = (id) => all('SELECT date, start_time AS start, end_time AS end FROM entry_sessions WHERE entry_id = ? ORDER BY date, start_time', id).map((r) => ({ ...r }));

describe('import-v1', () => {
  test('the dry run reports everything and changes nothing', async () => {
    const r = await importV1(t.app, { users, workspace, uploadsDir, dryRun: true });
    assert.equal(r.dryRun, true);
    assert.equal(r.counts.entries, 12);
    assert.equal(r.counts.posts, 9);
    assert.equal(r.counts.users, 2);
    assert.equal(all('SELECT COUNT(*) AS n FROM entries')[0].n, 0);
    assert.equal(all('SELECT COUNT(*) AS n FROM auth.users WHERE username = ?', 'ana.pop')[0].n, 0);
    assert.equal(all("SELECT COUNT(*) AS n FROM media WHERE original_name = 'cover-club.png'")[0].n, 0, 'no media ingested');
    assert.match(formatReport(r), /DRY RUN/);
  });

  test('the real import maps users, venues, platforms, entries, series and posts', async () => {
    const r = await importV1(t.app, { users, workspace, uploadsDir });
    assert.deepEqual(r.counts, { users: 2, spaces: 2, rooms: 2, platforms: 5, formats: 19, entries: 12, sessions: 17, bookings: 3, series: 1, posts: 9, media: 2 });
    assert.deepEqual(r.skipped.map((s) => s.reason).sort(), ['demo_user', 'demo_user']);
    assert.deepEqual(r.passkeyUsers, ['Ana.Pop']);
    const codes = r.warnings.map((w) => `${w.id}:${w.code}`);
    for (const c of ['lipsa.png:missing_file', 'evt-2:currency_assumed', 'evt-night:owner_unknown', 'evt-night:price_unparsed', 'evt-night:enroll_url_invalid']) assert.ok(codes.includes(c), c);

    // Users: the unset bootstrap root takes over v1 "admin"; others keep a legacy hash.
    const admin = all("SELECT * FROM auth.users WHERE username = 'admin'")[0];
    assert.equal(admin.is_root, 1);
    assert.equal(admin.status, 'active');
    assert.match(admin.password_hash, /^legacy-bcrypt:\$2/);
    const ana = all("SELECT * FROM auth.users WHERE username = 'ana.pop'")[0];
    assert.deepEqual([ana.role, ana.color, ana.status], ['moderator', 'owner-5', 'active']);
    assert.equal(all("SELECT COUNT(*) AS n FROM auth.users WHERE username IN ('demo', 'demo_admin') AND is_demo = 0")[0].n, 0);

    // Venues: capacities parsed from text, colours mapped to presets.
    const hall = all("SELECT * FROM spaces WHERE name LIKE 'Sala Mare%'")[0];
    assert.equal(hall.capacity_people, 80);
    assert.match(hall.color, /^owner-\d+$/);
    assert.equal(all("SELECT capacity_guests FROM rooms WHERE name LIKE 'Camera 1%'")[0].capacity_guests, 2);

    // Platforms: numbers from the standards text, notes kept.
    const tt = all("SELECT f.* FROM formats f JOIN platforms p ON p.id = f.platform_id WHERE p.slug = 'tiktok' ORDER BY f.position")[0];
    assert.deepEqual([tt.media_kind, tt.ratio_w, tt.ratio_h, tt.max_duration_s, tt.max_file_mb, tt.hook_length], ['video', 9, 16, 600, 72, 80]);
    assert.match(tt.file_size_note, /iOS/);
    const photos = all("SELECT f.* FROM formats f WHERE f.name LIKE 'Photo Mode%'")[0];
    assert.deepEqual([photos.media_kind, photos.max_items], ['carousel', 35]);
    assert.ok(all("SELECT icon_media_id FROM platforms WHERE slug = 'tiktok'")[0].icon_media_id, 'shipped icon attached');

    // A multi-day event with a legacy roomId: one session per day, check-out the day after.
    const masterclass = entry('4K Video Shoot & Production Masterclass (3-Day Intensive)')[0];
    assert.deepEqual(sessions(masterclass.id).map((s) => `${s.date} ${s.start}-${s.end}`), ['2026-09-14 14:00-17:00', '2026-09-15 14:00-17:00', '2026-09-16 14:00-17:00']);
    assert.deepEqual({ ...all('SELECT check_in, check_out, guests FROM room_bookings WHERE entry_id = ?', masterclass.id)[0] }, { check_in: '2026-09-14', check_out: '2026-09-17', guests: 1 });
    assert.deepEqual([masterclass.price_cents, masterclass.currency], [7500, 'EUR']);

    // Prices, location, promotion.
    const sync = entry('Q3 Content Strategy Sync')[0];
    assert.deepEqual([sync.price_cents, sync.price_note], [null, 'Team Internal']);
    assert.match(sync.description, /\n\nLocație: Conference Room A \/ Zoom$/);
    assert.equal(sync.cover_url.startsWith('https://'), true);
    const briefing = entry('Platform Standards & Compliance Briefing')[0];
    assert.equal(briefing.promotion_status, 'promoted');
    assert.equal(all('SELECT COUNT(*) AS n FROM posts WHERE event_id = ?', briefing.id)[0].n, 1);

    // Separate hours, midnight crossing, unknown owner.
    const ore = entry('Ore separate')[0];
    assert.deepEqual(sessions(ore.id).map((s) => `${s.start}-${s.end}`), ['10:00-11:00', '14:00-15:00', '16:00-17:00']);
    assert.deepEqual([ore.price_cents, ore.currency], [1250, 'EUR']);
    const night = entry('Maraton de noapte')[0];
    assert.deepEqual(sessions(night.id).map((s) => `${s.date} ${s.start}-${s.end}`), ['2026-10-12 22:00-24:00', '2026-10-13 00:00-02:00']);
    assert.equal(night.owner_id, admin.id);
    assert.equal(night.owner_name_snapshot, 'Fost Utilizator');
    assert.equal(night.price_note, 'la intrare, donație');
    assert.equal(night.cover_media_id, null);

    // Types: locked → blocked; room-only bookings with inclusive v1 end dates.
    assert.equal(entry('Mentenanță')[0].type, 'blocked');
    const rooms = entry('Oaspeți Ionescu')[0];
    assert.equal(rooms.type, 'room_only');
    assert.deepEqual(all('SELECT check_in, check_out FROM room_bookings WHERE entry_id = ? ORDER BY check_in', rooms.id).map((b) => `${b.check_in}→${b.check_out}`), [
      '2026-10-20→2026-10-23',
      '2026-10-21→2026-10-22',
    ]);

    // Recurrence: one monthly series of 3, the uploaded cover imported once.
    const club = entry('Club de lectură');
    assert.equal(club.length, 3);
    assert.deepEqual(club.map((e) => e.occurrence_index), [0, 1, 2]);
    assert.ok(club.every((e) => e.series_id === club[0].series_id && e.cover_media_id === club[0].cover_media_id && e.cover_media_id));
    const series = all('SELECT * FROM series WHERE id = ?', club[0].series_id)[0];
    assert.deepEqual(JSON.parse(series.rule), { freq: 'monthly_day', interval: 1, count: 3 });
    assert.deepEqual([series.start_date, series.end_date], ['2026-10-05', '2026-12-05']);
    assert.equal(club[0].promotion_status, null, 'socialStatus none → null');
    assert.deepEqual([club[0].price_cents, club[0].currency], [3000, 'RON']);

    // Posts: uploads imported as media, network share links kept.
    const up = all("SELECT * FROM posts WHERE title = 'Postare cu fișier'")[0];
    assert.equal(up.share_link, '\\\\nas\\marketing\\octombrie');
    assert.equal(all('SELECT COUNT(*) AS n FROM post_media WHERE post_id = ? AND media_id IS NOT NULL', up.id)[0].n, 1);
  });

  test('migrated users sign in with their v1 password, which is rehashed to argon2id', async () => {
    const c = new Client(t.http, '10.7.0.1');
    const r = await c.post('/auth/login', { username: 'ana.pop', password: 'parola veche v1' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(all("SELECT password_hash FROM auth.users WHERE username = 'ana.pop'")[0].password_hash, /^\$argon2id\$/);
    assert.equal((await new Client(t.http, '10.7.0.2').post('/auth/login', { username: 'ana.pop', password: 'greșită' })).status, 401);
    // Ana had passkeys in v1: the app invites her to add a new one.
    assert.equal((await c.get('/session')).data.user.passkeyInvite, true);
  });

  test('90 days after the import, admins see who never signed in', async () => {
    const admin = await t.as('admin', 'imp.admin');
    assert.deepEqual((await admin.get('/admin/summary')).data.migration.neverSignedIn, []);
    db().prepare("UPDATE settings SET value = ? WHERE key = 'v1_imported_at'").run(new Date(Date.now() - 91 * 86400_000).toISOString());
    const list = (await admin.get('/admin/summary')).data.migration.neverSignedIn.map((/** @type {any} */ u) => u.username);
    assert.deepEqual(list, ['admin'], 'ana signed in; the v1 admin did not');
    const users = (await admin.get('/users')).data.items;
    assert.equal(users.find((/** @type {any} */ u) => u.username === 'admin').legacyPassword, true);
    assert.equal(users.find((/** @type {any} */ u) => u.username === 'ana.pop').legacyPassword, false);
  });

  test('a second import is refused: only a fresh workspace', async () => {
    await assert.rejects(importV1(t.app, { users, workspace, uploadsDir }), /not empty/);
  });

  test('the CLI prints the dry-run report', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-import-'));
    try {
      const out = execFileSync(
        process.execPath,
        ['scripts/import-v1.mjs', '--users', path.join(FIX, 'users.json'), '--workspace', path.join(FIX, 'workspace.json'), '--uploads', uploadsDir, '--dry-run'],
        { env: { ...process.env, DATA_DIR: dir, APP_URL: 'http://localhost:3999', NODE_ENV: 'test', LOG_LEVEL: 'silent', HIBP_CHECK: '0' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      assert.match(out, /DRY RUN/);
      assert.match(out, /entries\s+12/);
      assert.match(out, /Passkeys are not migrated/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
