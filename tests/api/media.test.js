import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { startApp, Client } from './harness.js';
import { cleanupMedia, detectType, videoToolsAvailable } from '../../server/services/media.js';

const require = createRequire(import.meta.url);

/** @type {Awaited<ReturnType<typeof startApp>>} */
let t;
/** @type {any} */ let user;
/** @type {any} */ let admin;

before(async () => {
  t = await startApp();
  user = await t.as('user', 'm.user');
  admin = await t.as('admin', 'm.admin');
});
after(() => t.close());

/** @param {Client} c @param {Buffer} data @param {string} name */
const upload = (c, data, name) =>
  c.req('POST', '/api/v1/media', { raw: data, headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name) } });

/** A solid-colour image. @param {number} w @param {number} h @param {'png'|'jpeg'|'webp'} [fmt] */
const image = (w, h, fmt = 'png', seed = 0) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: (seed * 37) % 255, g: 120, b: 90 } } })[fmt]().toBuffer();

describe('type detection', () => {
  test('magic bytes, not names', async () => {
    assert.equal(detectType(await image(4, 4, 'png'))?.mime, 'image/png');
    assert.equal(detectType(await image(4, 4, 'jpeg'))?.mime, 'image/jpeg');
    assert.equal(detectType(await image(4, 4, 'webp'))?.mime, 'image/webp');
    assert.equal(detectType(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00'))?.mime, 'image/gif');
    assert.equal(detectType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    assert.equal(detectType(Buffer.from('<!doctype html><html></html>')), null);
    const mp4 = Buffer.alloc(32);
    mp4.write('ftypisom', 4, 'latin1');
    assert.equal(detectType(mp4)?.mime, 'video/mp4');
    const mov = Buffer.alloc(32);
    mov.write('ftypqt  ', 4, 'latin1');
    assert.equal(detectType(mov)?.mime, 'video/quicktime');
    const avif = Buffer.alloc(32);
    avif.write('ftypavif', 4, 'latin1');
    assert.equal(detectType(avif)?.mime, 'image/avif');
    assert.equal(detectType(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('....webm....')]))?.mime, 'video/webm');
  });
});

describe('uploads', () => {
  test('an image: dimensions, thumbnail, EXIF removed, name kept (diacritics)', async () => {
    const withGps = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#335577' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret', Artist: 'Ana' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '44/1 25/1 0/1' } })
      .toBuffer();
    assert.ok((await sharp(withGps).metadata()).exif, 'fixture has EXIF');
    const r = await upload(user, withGps, 'copertă ședință.png');
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.mime, 'image/jpeg', 'type from content, not the name');
    assert.equal(r.data.original_name, 'copertă ședință.png');
    assert.deepEqual([r.data.width, r.data.height], [1600, 900]);
    assert.ok(r.data.thumb_bytes > 0);
    const file = await user.req('GET', r.data.url);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/jpeg');
    assert.equal(file.headers.get('cache-control'), 'private, max-age=31536000, immutable');
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.match(file.headers.get('content-disposition') ?? '', /^inline/);
    const meta = await sharp(Buffer.from(file.data)).metadata();
    assert.equal(meta.exif, undefined, 'EXIF (GPS) stripped');
    const thumb = await user.req('GET', r.data.thumb_url);
    assert.equal(thumb.headers.get('content-type'), 'image/webp');
    assert.equal((await sharp(Buffer.from(thumb.data)).metadata()).width, 480);
  });

  test('SVG, HTML and unknown content are refused (415)', async () => {
    const svg = await upload(user, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png');
    assert.equal(svg.status, 415);
    assert.equal(svg.data.error.code, 'unsupported_media');
    assert.equal((await upload(user, Buffer.from('<html><body>hi</body></html>'), 'x.jpg')).status, 415);
    assert.equal((await upload(user, Buffer.alloc(0), 'x.jpg')).status, 400);
  });

  test('identical files are stored once; every uploader is recorded', async () => {
    const data = await image(300, 300, 'png', 7);
    const a = await upload(user, data, 'a.png');
    const b = await upload(admin, data, 'b.png');
    assert.equal(a.data.id, b.data.id);
    const mine = await admin.get('/api/v1/media?mine=1');
    assert.ok(mine.data.items.some((/** @type {any} */ m) => m.id === a.data.id));
    const owners = t.app.workspaces.main.db.prepare('SELECT COUNT(*) AS n FROM media_owners WHERE media_id = ?').get(a.data.id);
    assert.equal(/** @type {any} */ (owners).n, 2);
  });

  test('too large is refused while streaming (413)', async () => {
    const small = await startApp({ MAX_UPLOAD_MB: '1' });
    const c = await small.as('user', 'big');
    const r = await upload(c, Buffer.alloc(1.5 * 1024 * 1024, 1), 'big.bin');
    assert.equal(r.status, 413);
    small.close();
  });

  test('a video: metadata and a poster (ffmpeg), when available', { skip: !videoToolsAvailable() }, async () => {
    const tmp = path.join(os.tmpdir(), `ca-${Date.now()}.mp4`);
    execFileSync(/** @type {string} */ (/** @type {unknown} */ (require('ffmpeg-static'))), [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x180:rate=10', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-y', tmp,
    ]);
    const r = await upload(user, fs.readFileSync(tmp), 'clip.mp4');
    fs.rmSync(tmp, { force: true });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.kind, 'video');
    assert.deepEqual([r.data.width, r.data.height], [320, 180]);
    assert.ok(Math.abs(r.data.duration_s - 3) < 0.5);
    assert.equal(r.data.codec, 'h264');
    assert.ok(r.data.thumb_url);
    const range = await user.req('GET', r.data.url, { headers: { range: 'bytes=0-99' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-length'), '100');
  });
});

describe('access and workspaces', () => {
  test('files need a session of the same workspace', async () => {
    const r = await upload(user, await image(200, 100, 'png', 3), 'p.png');
    assert.equal((await new Client(t.http).req('GET', r.data.url)).status, 401);
    const demo = new Client(t.http, '10.30.0.1');
    await demo.demo('demo');
    assert.equal((await demo.req('GET', r.data.url)).status, 404, 'demo cannot see main media');
    const d = await upload(demo, await image(200, 100, 'png', 4), 'd.png');
    assert.equal((await user.req('GET', d.data.url)).status, 404, 'main cannot see demo media');
    assert.equal((await demo.req('GET', d.data.url)).status, 200);
    assert.equal((await user.req('GET', `/media/${r.data.id}/nope`)).status, 404);
  });

  test('demo uploads: 20 per 10 minutes per IP', async () => {
    const ip = '10.31.0.1';
    const a = new Client(t.http, ip);
    await a.demo('demo');
    const b = new Client(t.http, ip);
    await b.demo('demo_admin');
    const png = await image(10, 10, 'png', 9);
    for (let i = 0; i < 10; i++) assert.equal((await upload(a, png, 'x.png')).status, 201);
    for (let i = 0; i < 10; i++) assert.equal((await upload(b, png, 'x.png')).status, 201);
    assert.equal((await upload(a, png, 'x.png')).status, 429, 'shared by everyone on that IP');
  });

  test('the sample cover exists in the demo only', async () => {
    const demo = new Client(t.http, '10.32.0.1');
    await demo.demo('demo');
    const s = await demo.get('/api/v1/media/sample-cover');
    assert.equal(s.status, 200);
    assert.deepEqual([s.data.width, s.data.height], [1600, 900]);
    assert.equal((await user.get('/api/v1/media/sample-cover')).status, 404);
  });
});

describe('crop, cap and cleanup', () => {
  test('crop to 16:9 creates a new media file', async () => {
    const sq = await upload(user, await image(1000, 1000, 'png', 11), 'patrat.png');
    const r = await user.post(`/api/v1/media/${sq.data.id}/crop`, { x: 0, y: 200, w: 1000, h: 563 });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.notEqual(r.data.id, sq.data.id);
    assert.deepEqual([r.data.width, r.data.height], [1000, 563]);
    assert.equal(r.data.original_name, 'patrat-16x9.png');
    assert.equal((await user.post(`/api/v1/media/${sq.data.id}/crop`, { x: 500, y: 0, w: 1000, h: 563 })).status, 400);
  });

  test('covers must be 16:9 when they are uploaded media', async () => {
    const hall = (await user.get('/spaces')).data.items[0].id;
    const sq = await upload(user, await image(800, 800, 'png', 12), 'sq.png');
    const wide = await upload(user, await image(1280, 720, 'png', 13), 'wide.png');
    const ev = (cover) => ({ entry: { type: 'event', title: 'C', space_id: hall, sessions: [{ date: '2099-01-10', start: '10:00', end: '11:00' }], enroll_url: 'https://x.ro', cover_media_id: cover, price_cents: null } });
    const bad = await user.post('/entries', ev(sq.data.id));
    assert.equal(bad.data.error.details.fields.cover, 'cover_not_16_9');
    assert.equal((await user.post('/entries', ev(wide.data.id))).status, 201);
  });

  test('uploads are refused at the storage cap (507); deleting stays possible', async () => {
    const small = await startApp();
    const a = await small.as('admin', 'cap.admin');
    const used = (await a.get('/settings')).data.storage.used;
    await a.patch('/settings', { storage_cap_bytes: used + 2000 });
    const r = await upload(a, await image(400, 400, 'png', 21), 'full.png');
    assert.equal(r.status, 507);
    assert.equal(r.data.error.code, 'storage_full');
    small.close();
  });

  test('cleanup removes unreferenced media older than 24 h; referenced media stays', async () => {
    const ws = t.app.workspaces.main;
    const orphan = await upload(user, await image(64, 64, 'png', 31), 'orphan.png');
    const fresh = await upload(user, await image(64, 64, 'png', 32), 'fresh.png');
    const used = await upload(user, await image(1280, 720, 'png', 33), 'used.png');
    const hall = (await user.get('/spaces')).data.items[0].id;
    await user.post('/entries', { entry: { type: 'event', title: 'Folosit', space_id: hall, sessions: [{ date: '2099-02-10', start: '10:00', end: '11:00' }], enroll_url: 'https://x.ro', cover_media_id: used.data.id, price_cents: null } });
    ws.db.prepare("UPDATE media SET created_at = '2020-01-01T00:00:00Z' WHERE id IN (?, ?)").run(orphan.data.id, used.data.id);
    const file = path.join(ws.mediaDir, /** @type {any} */ (ws.db.prepare('SELECT path FROM media WHERE id = ?').get(orphan.data.id)).path);
    assert.ok(fs.existsSync(file));
    const preview = cleanupMedia(t.app, ws, { dryRun: true });
    assert.ok(preview.removed >= 1);
    const r = cleanupMedia(t.app, ws);
    assert.ok(r.removed >= 1);
    assert.ok(r.bytes > 0);
    assert.equal(fs.existsSync(file), false);
    assert.equal((await user.get(`/api/v1/media/${orphan.data.id}`)).status, 404);
    assert.equal((await user.get(`/api/v1/media/${fresh.data.id}`)).status, 200, 'grace period');
    assert.equal((await user.get(`/api/v1/media/${used.data.id}`)).status, 200, 'referenced');
  });

  test('storage usage equals the media rows plus the database file', async () => {
    const s = (await admin.get('/settings')).data.storage;
    const ws = t.app.workspaces.main;
    const rows = /** @type {any} */ (ws.db.prepare('SELECT SUM(bytes + thumb_bytes) AS n FROM media').get()).n;
    assert.equal(s.mediaBytes, rows);
    // And the rows match the files on disk.
    let disk = 0;
    for (const m of /** @type {any[]} */ (ws.db.prepare('SELECT path, thumb_path FROM media').all())) {
      disk += fs.statSync(path.join(ws.mediaDir, m.path)).size;
      if (m.thumb_path) disk += fs.statSync(path.join(ws.mediaDir, m.thumb_path)).size;
    }
    assert.equal(disk, rows);
  });
});
