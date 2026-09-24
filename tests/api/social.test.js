import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { startApp } from './harness.js';
import { addDays, nextFullHour, todayIn } from '../../shared/rules/time.js';

/** @type {Awaited<ReturnType<typeof startApp>>} */
let t;
/** @type {any} */ let admin;
/** @type {any} */ let user;
const TZ = 'Europe/Bucharest';
const today = () => todayIn(TZ);

before(async () => {
  t = await startApp();
  admin = await t.as('admin', 's.admin');
  user = await t.as('user', 's.user');
});
after(() => t.close());

const platforms = async () => (await admin.get('/platforms')).data.items;
/** @param {string} slug */
const platform = async (slug) => (await platforms()).find((/** @type {any} */ p) => p.slug === slug);

/** A post body on Instagram's first format. @param {Record<string, any>} [extra] */
async function postBody(extra = {}) {
  const ig = await platform('instagram');
  return {
    platform_id: ig.id,
    format_id: ig.formats[0].id,
    publish_date: addDays(today(), 5),
    publish_time: '10:00',
    title: 'Postare test',
    caption: 'Text scurt',
    status: 'draft',
    media: [],
    ...extra,
  };
}

/** @param {number} w @param {number} h */
async function uploadImage(w, h, seed = 1) {
  const data = await sharp({ create: { width: w, height: h, channels: 3, background: { r: seed * 20, g: 60, b: 90 } } }).png().toBuffer();
  const r = await admin.req('POST', '/api/v1/media', { raw: data, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'img.png' } });
  assert.equal(r.status, 201);
  return r.data;
}

describe('platforms and formats', () => {
  test('the seed has 5 platforms with 19 formats, icons and notes', async () => {
    const items = await platforms();
    assert.deepEqual(items.map((/** @type {any} */ p) => p.slug), ['tiktok', 'instagram', 'facebook', 'youtube', 'reddit']);
    assert.equal(items.reduce((n, /** @type {any} */ p) => n + p.formats.length, 0), 19);
    for (const p of items) assert.match(p.icon_url, /^\/media\/.+\/original$/);
    const tt = items[0].formats[0];
    assert.equal(tt.ratio, '9:16');
    assert.equal(tt.max_file_mb, 72);
    assert.match(tt.file_size_note, /iOS/);
  });

  test('non-admins are refused', async () => {
    assert.equal((await user.get('/platforms')).status, 403);
    assert.equal((await user.get('/posts')).status, 403);
  });

  test('a new platform starts with two formats and fetches its favicon once', async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#00f' } }).png().toBuffer();
    /** @type {string[]} */ const fetched = [];
    t.app.fetchFavicon = async (d) => (fetched.push(d), png);
    const r = await admin.post('/platforms', { name: 'Bluesky Social', color: '#1185fe', domain: 'https://www.bsky.app/profile', description: null });
    assert.equal(r.status, 201);
    assert.equal(r.data.slug, 'bluesky-social');
    assert.equal(r.data.domain, 'bsky.app');
    assert.deepEqual(r.data.formats.map((/** @type {any} */ f) => [f.media_kind, f.ratio]), [['image', '4:5'], ['video', '9:16']]);
    for (let i = 0; i < 20 && !(await platform('bluesky-social')).icon_url; i++) await new Promise((res) => setTimeout(res, 20));
    assert.deepEqual(fetched, ['bsky.app']);
    assert.match((await platform('bluesky-social')).icon_url, /^\/media\//);
    delete t.app.fetchFavicon;

    const again = await admin.post('/platforms', { name: 'Bluesky Social', color: '#1185fe' });
    assert.equal(again.data.slug, 'bluesky-social-2');
    assert.equal((await admin.post('/platforms', { name: 'X', color: 'blue' })).status, 400);
    assert.equal((await admin.post('/platforms', { name: 'X', color: '#123456', domain: 'not a domain' })).status, 400);
  });

  test('PATCH only changes the fields sent (disable stays disabled)', async () => {
    const p = await platform('bluesky-social-2');
    const off = await admin.patch(`/platforms/${p.id}`, { enabled: false }, p.version);
    assert.equal(off.status, 200);
    const renamed = await admin.patch(`/platforms/${p.id}`, { description: 'Descriere' }, off.data.version);
    assert.equal(renamed.data.enabled, false);
    assert.equal(renamed.data.name, 'Bluesky Social');
    assert.equal((await admin.patch(`/platforms/${p.id}`, { name: 'Y' })).status, 428);
    assert.equal((await admin.patch(`/platforms/${p.id}`, { name: 'Y' }, 1)).status, 409);
  });

  test('formats: every field is editable; a platform keeps at least one', async () => {
    const p = await platform('bluesky-social-2');
    const [f1, f2] = p.formats;
    const upd = await admin.patch(`/platforms/${p.id}/formats/${f1.id}`, { hook_length: 120, safe_zone: 'Sus 100px', max_duration_s: 60, min_duration_s: 3 }, f1.version);
    assert.equal(upd.status, 200);
    assert.equal(upd.data.hook_length, 120);
    assert.equal(upd.data.name, f1.name);
    const bad = await admin.patch(`/platforms/${p.id}/formats/${f1.id}`, { min_duration_s: 90 }, upd.data.version);
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error.details.fields.max_duration_s, 'max_below_min');
    const added = await admin.post(`/platforms/${p.id}/formats`, { name: 'Carusel', media_kind: 'carousel', ratio_w: 1, ratio_h: 1, width: 1080, height: 1080, caption_limit: 300, max_items: 4 });
    assert.equal(added.status, 201);
    const re = await admin.post(`/platforms/${p.id}/formats/reorder`, { ids: [added.data.id, f1.id, f2.id] });
    assert.deepEqual(re.data.formats.map((/** @type {any} */ f) => f.id), [added.data.id, f1.id, f2.id]);
    assert.equal((await admin.del(`/platforms/${p.id}/formats/${f2.id}`, f2.version)).status, 200);
    assert.equal((await admin.del(`/platforms/${p.id}/formats/${added.data.id}`, added.data.version)).status, 200);
    const last = (await platform('bluesky-social-2')).formats[0];
    const r = await admin.del(`/platforms/${p.id}/formats/${last.id}`, last.version);
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'last_format');
  });

  test('a format in use is refused (409 in_use) unless its posts move first', async () => {
    const ig = await platform('instagram');
    const f = ig.formats.find((/** @type {any} */ x) => x.post_count > 0);
    assert.ok(f, 'seed posts use an Instagram format');
    const r = await admin.del(`/platforms/${ig.id}/formats/${f.id}`, f.version);
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'in_use');
    assert.equal(r.data.error.details.count, f.post_count);
    const other = ig.formats.find((/** @type {any} */ x) => x.id !== f.id);
    const moved = await admin.req('DELETE', `/platforms/${ig.id}/formats/${f.id}`, { version: f.version, body: { moveTo: other.id } });
    assert.equal(moved.status, 200);
    const after = await platform('instagram');
    assert.equal(after.formats.find((/** @type {any} */ x) => x.id === other.id).post_count, other.post_count + f.post_count);
  });

  test('deleting a platform with posts: move with a format map, or delete after typing the name', async () => {
    const yt = await platform('youtube');
    const fb = await platform('facebook');
    assert.ok(yt.post_count > 0);
    const r1 = await admin.del(`/platforms/${yt.id}`, yt.version);
    assert.equal(r1.status, 409);
    assert.equal(r1.data.error.code, 'in_use');
    const wrong = await admin.req('DELETE', `/platforms/${yt.id}`, { version: yt.version, body: { mode: 'delete', confirmName: 'youtube' } });
    assert.equal(wrong.status, 400);
    const used = yt.formats.filter((/** @type {any} */ f) => f.post_count);
    const noMap = await admin.req('DELETE', `/platforms/${yt.id}`, { version: yt.version, body: { mode: 'move', confirmName: 'YouTube', targetPlatformId: fb.id } });
    assert.equal(noMap.status, 400);
    const formatMap = Object.fromEntries(used.map((/** @type {any} */ f) => [f.id, fb.formats[0].id]));
    const ok = await admin.req('DELETE', `/platforms/${yt.id}`, { version: yt.version, body: { mode: 'move', confirmName: 'YouTube', targetPlatformId: fb.id, formatMap } });
    assert.equal(ok.status, 200);
    assert.equal((await platform('facebook')).post_count, fb.post_count + yt.post_count);

    const rd = await platform('reddit');
    const before = (await admin.get('/posts')).data.items.length;
    const del = await admin.req('DELETE', `/platforms/${rd.id}`, { version: rd.version, body: { mode: 'delete', confirmName: 'Reddit' } });
    assert.equal(del.status, 200);
    assert.equal((await admin.get('/posts')).data.items.length, before - rd.post_count);
  });

  test('reset restores the defaults and never touches posts', async () => {
    const posts = (await admin.get('/posts')).data.items.length;
    const r = await admin.post('/platforms/reset', {});
    assert.equal(r.status, 200);
    const slugs = r.data.items.map((/** @type {any} */ p) => p.slug);
    assert.deepEqual(slugs.slice(0, 5), ['tiktok', 'instagram', 'facebook', 'youtube', 'reddit']);
    assert.ok(!slugs.includes('bluesky-social'), 'unused custom platforms go');
    assert.ok(r.data.items.slice(0, 5).every((/** @type {any} */ p) => p.icon_url && p.enabled));
    assert.equal((await admin.get('/posts')).data.items.length, posts);
  });

  test('reorder platforms', async () => {
    const ids = (await platforms()).map((/** @type {any} */ p) => p.id);
    const r = await admin.post('/platforms/reorder', { ids: [ids[2], ids[0]] });
    assert.deepEqual(r.data.items.map((/** @type {any} */ p) => p.id).slice(0, 3), [ids[2], ids[0], ids[1]]);
  });

  test('the last platform cannot be deleted', async () => {
    const t2 = await startApp({ SEED_SAMPLE_CONTENT: '0' });
    try {
      const a = await t2.as('admin');
      const items = (await a.get('/platforms')).data.items;
      for (const p of items.slice(1)) assert.equal((await a.del(`/platforms/${p.id}`, p.version)).status, 200);
      const r = await a.del(`/platforms/${items[0].id}`, items[0].version);
      assert.equal(r.status, 409);
      assert.equal(r.data.error.code, 'last_platform');
    } finally {
      t2.close();
    }
  });
});

describe('posts', () => {
  test('create, read, update, delete with media and a network share link', async () => {
    const img = await uploadImage(1080, 1350);
    const body = await postBody({ media: [{ media_id: img.id }, { url: 'https://example.com/b.jpg' }], share_link: '\\\\nas\\marketing\\toamna' });
    const r = await admin.post('/posts', body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.media.length, 2);
    assert.equal(r.data.media[0].media.width, 1080);
    assert.equal(r.data.media[1].url, 'https://example.com/b.jpg');
    assert.equal(r.data.share_link, '\\\\nas\\marketing\\toamna');
    assert.equal(r.headers.get('etag'), 'W/"1"');

    const upd = await admin.patch(`/posts/${r.data.id}`, { title: 'Titlu nou' }, 1);
    assert.equal(upd.status, 200);
    assert.equal(upd.data.media.length, 2, 'PATCH without media keeps the media');
    assert.equal(upd.data.share_link, body.share_link);
    const cleared = await admin.patch(`/posts/${r.data.id}`, { media: [] }, upd.data.version);
    assert.equal(cleared.data.media.length, 0);
    assert.equal((await admin.post('/posts', { ...body, share_link: 'javascript:alert(1)' })).status, 400);
    assert.equal((await admin.del(`/posts/${r.data.id}`, cleared.data.version)).status, 200);
    assert.equal((await admin.get(`/posts/${r.data.id}`)).status, 404);
  });

  test('the format must belong to the platform; disabled platforms only for existing posts', async () => {
    const fb = await platform('facebook');
    const body = await postBody();
    const r = await admin.post('/posts', { ...body, format_id: fb.formats[0].id });
    assert.equal(r.status, 400);
    assert.equal(r.data.error.details.fields.format_id, 'not_found');
    const created = await admin.post('/posts', body);
    const ig = await platform('instagram');
    const off = await admin.patch(`/platforms/${ig.id}`, { enabled: false }, ig.version);
    assert.equal((await admin.post('/posts', body)).data.error.details.fields.platform_id, 'platform_disabled');
    const edit = await admin.patch(`/posts/${created.data.id}`, { title: 'Încă merge' }, created.data.version);
    assert.equal(edit.status, 200);
    assert.equal(edit.data.platform.enabled, false);
    await admin.patch(`/platforms/${ig.id}`, { enabled: true }, off.data.version);
  });

  test('past-date rule: only published posts can be dated in the past', async () => {
    const past = { publish_date: addDays(today(), -2), publish_time: '09:00' };
    const draft = await admin.post('/posts', await postBody({ ...past, status: 'draft' }));
    assert.equal(draft.status, 400);
    assert.equal(draft.data.error.details.fields.publish_date, 'post_in_past');
    const pub = await admin.post('/posts', await postBody({ ...past, status: 'published' }));
    assert.equal(pub.status, 201);
    // Editing a past post without moving it is fine, even to draft.
    const edit = await admin.patch(`/posts/${pub.data.id}`, { title: 'Corectat', status: 'draft' }, pub.data.version);
    assert.equal(edit.status, 200);
    // Moving a future draft into the past is refused; as published it's allowed.
    const future = await admin.post('/posts', await postBody());
    assert.equal((await admin.patch(`/posts/${future.data.id}`, past, future.data.version)).status, 400);
    assert.equal((await admin.patch(`/posts/${future.data.id}`, { ...past, status: 'published' }, future.data.version)).status, 200);
    const nh = nextFullHour(TZ);
    assert.equal((await admin.post('/posts', await postBody({ publish_date: nh.date, publish_time: nh.time }))).status, 201);
  });

  test('scheduled posts must pass media and caption checks; drafts need not', async () => {
    const tt = await platform('tiktok');
    const video = tt.formats.find((/** @type {any} */ f) => f.media_kind === 'video');
    const img = await uploadImage(1080, 1920, 3);
    const body = await postBody({ platform_id: tt.id, format_id: video.id, media: [{ media_id: img.id }], caption: 'x'.repeat(video.caption_limit + 1) });
    const sched = await admin.post('/posts', { ...body, status: 'scheduled' });
    assert.equal(sched.status, 422);
    assert.equal(sched.data.error.code, 'post_not_ready');
    assert.deepEqual(sched.data.error.details.blockers.map((/** @type {any} */ b) => b.code).sort(), ['caption_too_long', 'kind_mismatch']);
    assert.equal((await admin.post('/posts', { ...body, status: 'draft' })).status, 201);
    // Warnings (ratio, resolution) never block.
    const ig = await platform('instagram');
    const small = await uploadImage(500, 500, 4);
    const ok = await admin.post('/posts', await postBody({ platform_id: ig.id, format_id: ig.formats.find((/** @type {any} */ f) => f.media_kind === 'image').id, media: [{ media_id: small.id }], status: 'scheduled' }));
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
  });

  test('carousels are limited by max_items; other kinds take one item', async () => {
    const ig = await platform('instagram');
    const single = ig.formats.find((/** @type {any} */ f) => f.media_kind === 'image');
    const media = [{ url: 'https://example.com/1.jpg' }, { url: 'https://example.com/2.jpg' }];
    const r = await admin.post('/posts', await postBody({ format_id: single.id, media, status: 'scheduled' }));
    assert.equal(r.status, 422);
    assert.equal(r.data.error.details.blockers[0].code, 'too_many_items');
  });

  test('filters: range, platform, status and a diacritics-insensitive search', async () => {
    const tt = await platform('tiktok');
    await admin.post('/posts', await postBody({ platform_id: tt.id, format_id: tt.formats[0].id, title: 'Lansare de toamnă', caption: 'Ședință foto' }));
    const q = await admin.get('/posts?q=sedinta');
    assert.ok(q.data.items.some((/** @type {any} */ p) => p.title === 'Lansare de toamnă'));
    const byFormat = await admin.get(`/posts?q=${encodeURIComponent(tt.formats[0].name.slice(0, 10))}`);
    assert.ok(byFormat.data.items.length > 0);
    const plat = await admin.get(`/posts?platform=${tt.id}&status=draft`);
    assert.ok(plat.data.items.every((/** @type {any} */ p) => p.platform_id === tt.id && p.status === 'draft'));
    const from = addDays(today(), 1);
    const range = await admin.get(`/posts?from=${from}&to=${addDays(today(), 10)}`);
    assert.ok(range.data.items.every((/** @type {any} */ p) => p.publish_date >= from));
    assert.equal((await admin.get('/posts?status=nope')).status, 400);
  });

  test('linking a post promotes its event; deleting the last post returns it to pending', async () => {
    const spaces = (await admin.get('/spaces')).data.items;
    const d = addDays(today(), 40);
    const ev = await admin.post('/entries', {
      entry: { type: 'event', title: 'De promovat', space_id: spaces[0].id, sessions: [{ date: d, start: '10:00', end: '11:00' }], enroll_url: 'https://example.com/e', cover_url: 'https://example.com/c.jpg', price_cents: null },
    });
    assert.equal(ev.status, 201, JSON.stringify(ev.data));
    const id = ev.data.id ?? ev.data.entry?.id;
    const promo = async () => (await admin.get(`/entries/${id}`)).data.promotion_status;
    assert.equal(await promo(), 'pending');
    const p1 = await admin.post('/posts', await postBody({ event_id: id }));
    const p2 = await admin.post('/posts', await postBody({ event_id: id }));
    assert.equal(p1.data.event.title, 'De promovat');
    assert.equal(await promo(), 'promoted');
    await admin.del(`/posts/${p1.data.id}`, p1.data.version);
    assert.equal(await promo(), 'promoted');
    await admin.patch(`/posts/${p2.data.id}`, { event_id: null }, p2.data.version);
    assert.equal(await promo(), 'pending');
    const bad = await admin.post('/posts', await postBody({ event_id: '01900000-0000-7000-8000-000000000000' }));
    assert.equal(bad.data.error.details.fields.event_id, 'invalid_event');
  });
});

describe('export and import', () => {
  test('export → import round-trips with an empty diff', async () => {
    const r = await admin.get('/social/export');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="social-\d{4}-\d{2}-\d{2}\.json"/);
    const doc = r.data;
    assert.equal(doc.schemaVersion, 1);
    assert.ok(doc.posts.length > 0);
    const dry = await admin.post('/social/import?dryRun=1', doc);
    assert.equal(dry.status, 200, JSON.stringify(dry.data));
    assert.deepEqual(dry.data.diff.platforms, { added: [], updated: [], removed: [], kept: [] });
    assert.deepEqual(dry.data.diff.posts, { added: 0, updated: 0, removed: 0, unchanged: doc.posts.length });
  });

  test('the dry run previews the changes and changes nothing; the real import applies them', async () => {
    const doc = (await admin.get('/social/export')).data;
    const before = JSON.stringify((await admin.get('/social/export')).data.platforms);
    doc.platforms[0].name = 'TikTok Nou';
    doc.platforms[0].formats[0].caption_limit = 150;
    doc.platforms.push({ slug: 'mastodon', name: 'Mastodon', color: '#6364ff', enabled: true, formats: [{ name: 'Toot', media_kind: 'image', ratio_w: 16, ratio_h: 9, width: 1280, height: 720, caption_limit: 500 }] });
    const unusedIdx = doc.platforms.findIndex((/** @type {any} */ p) => !doc.posts.some((/** @type {any} */ x) => x.platform === p.slug));
    const removed = unusedIdx >= 0 ? doc.platforms.splice(unusedIdx, 1)[0] : null;
    doc.posts[0].title = 'Titlu importat';
    const gone = doc.posts.pop();
    doc.posts.push({ platform: 'mastodon', format: 'Toot', publish_date: addDays(today(), 3), publish_time: '12:00', title: 'Din import', caption: '', status: 'draft', media: [] });

    const dry = await admin.post('/social/import?dryRun=1', doc);
    assert.equal(dry.status, 200, JSON.stringify(dry.data));
    const d = dry.data.diff;
    assert.deepEqual(d.platforms.added, ['Mastodon']);
    assert.ok(d.platforms.updated.includes('TikTok Nou'));
    if (removed) assert.deepEqual(d.platforms.removed, [removed.name]);
    assert.equal(d.posts.added, 1);
    assert.equal(d.posts.updated, 1);
    assert.equal(d.posts.removed, 1);
    assert.equal(JSON.stringify((await admin.get('/social/export')).data.platforms), before, 'dry run changes nothing');

    const real = await admin.post('/social/import', doc);
    assert.deepEqual(real.data.diff, d);
    const after = (await admin.get('/social/export')).data;
    assert.equal(after.platforms[0].name, 'TikTok Nou');
    assert.equal(after.platforms[0].formats[0].caption_limit, 150);
    assert.ok(after.posts.some((/** @type {any} */ p) => p.title === 'Din import'));
    assert.ok(!after.posts.some((/** @type {any} */ p) => p.id === gone.id));
  });

  test('an invalid file is refused whole, and nothing changes', async () => {
    const before = (await admin.get('/social/export')).data;
    const bad = { ...before, schemaVersion: 2 };
    assert.equal((await admin.post('/social/import', bad)).status, 400);
    const unknown = { ...before, posts: [...before.posts, { platform: 'nope', format: 'x', publish_date: today(), publish_time: '10:00', title: 'x', status: 'draft', media: [] }] };
    const r = await admin.post('/social/import', unknown);
    assert.equal(r.status, 400);
    const after = (await admin.get('/social/export')).data;
    assert.deepEqual({ ...after, exportedAt: null }, { ...before, exportedAt: null });
  });
});
