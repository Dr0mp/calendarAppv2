import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './harness.js';
import { addDays, todayIn } from '../../shared/rules/time.js';

/** @type {Awaited<ReturnType<typeof startApp>>} */
let t;
/** @type {any} */ let admin;
/** @type {any} */ let user;
const today = () => todayIn('Europe/Bucharest');

before(async () => {
  t = await startApp({ SEED_SAMPLE_CONTENT: '0' });
  admin = await t.as('admin', 'pr.admin');
  user = await t.as('user', 'pr.user');
});
after(() => t.close());

let day = 40;
/** @param {any} c @param {Record<string, any>} extra */
async function event(c, extra = {}) {
  day += 1;
  const spaces = (await c.get('/spaces')).data.items;
  const r = await c.post('/entries', {
    entry: {
      type: 'event', title: 'Eveniment', space_id: spaces[0].id, sessions: [{ date: addDays(today(), day), start: '18:00', end: '20:00' }],
      enroll_url: 'https://example.com/inscriere', cover_url: 'https://example.com/c.jpg', price_cents: 7500, currency: 'RON', ...extra,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.entry ?? r.data;
}
const queue = async (/** @type {string} */ filter = 'pending') => (await admin.get(`/promotions?filter=${filter}`)).data;

describe('promotion queue', () => {
  test('lists upcoming public events only, soonest first, with counts', async () => {
    const later = await event(user, { title: 'Mai târziu', sessions: [{ date: addDays(today(), 30), start: '10:00', end: '11:00' }] });
    const sooner = await event(user, { title: 'Mai curând', sessions: [{ date: addDays(today(), 5), start: '10:00', end: '11:00' }] });
    await user.post('/entries', { entry: { type: 'blocked', title: 'Blocat', sessions: [{ date: addDays(today(), 6), start: '10:00', end: '11:00' }] } });
    const q = await queue();
    const ids = q.items.map((/** @type {any} */ i) => i.id);
    assert.ok(ids.indexOf(sooner.id) < ids.indexOf(later.id));
    assert.ok(q.items.every((/** @type {any} */ i) => i.promotion_status === 'pending'));
    assert.ok(!q.items.some((/** @type {any} */ i) => i.title === 'Blocat'));
    const first = q.items.find((/** @type {any} */ i) => i.id === sooner.id);
    assert.deepEqual(first.next, { date: addDays(today(), 5), time: '10:00' });
    assert.equal(first.owner.name, 'pr.user');
    assert.equal(first.cover.url, 'https://example.com/c.jpg');
    assert.equal(q.counts.pending, q.items.length);
    assert.equal((await t.as('user').then((u) => u.get('/promotions'))).status, 403);
    assert.equal((await admin.get('/promotions?filter=nope')).status, 400);
    const counts = (await admin.get('/me/counts')).data;
    assert.equal(counts.promotions, q.counts.pending);
  });

  test('skip and undo; the filters actually filter', async () => {
    const e = await event(user, { title: 'De ignorat' });
    assert.equal((await admin.post(`/promotions/${e.id}/skip`)).data.promotion_status, 'skipped');
    assert.ok(!(await queue()).items.some((/** @type {any} */ i) => i.id === e.id));
    assert.ok((await queue('skipped')).items.some((/** @type {any} */ i) => i.id === e.id));
    assert.ok((await queue('all')).items.some((/** @type {any} */ i) => i.id === e.id));
    assert.ok(!(await queue('promoted')).items.some((/** @type {any} */ i) => i.id === e.id));
    assert.equal((await admin.del(`/promotions/${e.id}/skip`)).data.promotion_status, 'pending');
    assert.ok((await queue()).items.some((/** @type {any} */ i) => i.id === e.id));
    assert.equal((await admin.post('/promotions/01900000-0000-7000-8000-000000000000/skip')).status, 404);
  });

  test('the draft: platform, 16:9 format, date, title, caption from the template, cover and link', async () => {
    const e = await event(user, { title: 'Concert de toamnă', description: 'O seară specială.', sessions: [{ date: addDays(today(), 20), start: '19:30', end: '21:00' }] });
    assert.ok(e.id);
    const d = (await admin.get(`/promotions/${e.id}/draft`)).data;
    const fb = (await admin.get('/platforms')).data.items.find((/** @type {any} */ p) => p.slug === 'facebook');
    assert.equal(d.platform_id, fb.id, 'Facebook when nothing was used before');
    // Facebook has no 16:9 image format, so the platform's first format is used.
    assert.equal(d.format_id, fb.formats[0].id);
    const yt = (await admin.get('/platforms')).data.items.find((/** @type {any} */ p) => p.slug === 'youtube');
    const other = await event(user, { title: 'Pe YouTube' });
    const yp = await admin.post('/posts', { platform_id: yt.id, format_id: yt.formats[0].id, publish_date: addDays(today(), 2), publish_time: '10:00', title: 'YT', status: 'draft', event_id: other.id });
    assert.equal(yp.status, 201);
    assert.deepEqual([d.publish_date, d.publish_time], [addDays(today(), 13), '10:00']);
    const dy = (await admin.get(`/promotions/${e.id}/draft`)).data;
    assert.equal(dy.platform_id, yt.id, 'the last used platform');
    assert.equal(yt.formats.find((/** @type {any} */ x) => x.id === dy.format_id).name, 'Custom Thumbnail (16:9)');
    assert.equal(d.title, 'Promovare: Concert de toamnă');
    assert.match(d.caption, /^🚀 Concert de toamnă\nSusținut de pr\.user\n📅 .+, 19:30 · .+\n🎟️ 75\sRON\n🔗 Înscrieri: https:\/\/example\.com\/inscriere\n\nO seară specială\.$/);
    assert.deepEqual(d.media, [{ url: 'https://example.com/c.jpg' }]);
    assert.equal(d.event_id, e.id);

    // A line whose placeholder is empty is dropped; the template is editable.
    const s = (await admin.get('/settings')).data;
    await admin.patch('/settings', { promo_template: '{title}\nPreț: {price}\nNotă: {description}' }, s.version);
    const free = await event(user, { title: 'Gratuit', price_cents: null, currency: null });
    assert.equal((await admin.get(`/promotions/${free.id}/draft`)).data.caption, 'Gratuit\nPreț: Gratuit');
  });

  test('flow 7: a post from an event promotes it; deleting that post returns it to pending', async () => {
    const e = await event(user, { title: 'Flow 7' });
    const d = (await admin.get(`/promotions/${e.id}/draft`)).data;
    const ig = (await admin.get('/platforms')).data.items.find((/** @type {any} */ p) => p.slug === 'instagram');
    const body = { ...d, platform_id: ig.id, format_id: ig.formats[0].id, media: d.media.map((/** @type {any} */ m) => (m.media_id ? { media_id: m.media_id } : { url: m.url })) };
    delete body.event;
    const post = await admin.post('/posts', body);
    assert.equal(post.status, 201, JSON.stringify(post.data));
    const promoted = (await queue('promoted')).items.find((/** @type {any} */ i) => i.id === e.id);
    assert.equal(promoted.promotion_status, 'promoted');
    assert.equal(promoted.posts[0].platform.name, 'Instagram');
    assert.ok(!(await queue()).items.some((/** @type {any} */ i) => i.id === e.id));
    // The platform is remembered for the next promotion.
    const next = await event(user, { title: 'Următorul' });
    assert.equal((await admin.get(`/promotions/${next.id}/draft`)).data.platform_id, ig.id);
    // Skipping a promoted event is refused.
    assert.equal((await admin.post(`/promotions/${e.id}/skip`)).status, 409);

    await admin.del(`/posts/${post.data.id}`, post.data.version);
    assert.ok((await queue()).items.some((/** @type {any} */ i) => i.id === e.id));
  });

  test('changing an event to a blocked slot removes it from the queue but keeps its posts', async () => {
    const e = await event(user, { title: 'Devine blocare' });
    const d = (await admin.get(`/promotions/${e.id}/draft`)).data;
    delete d.event;
    d.media = [];
    const post = await admin.post('/posts', d);
    assert.equal(post.status, 201, JSON.stringify(post.data));
    const cur = (await user.get(`/entries/${e.id}`)).data;
    const upd = await user.patch(`/entries/${e.id}`, { type: 'blocked', title: 'Devine blocare', sessions: cur.sessions }, cur.version);
    assert.equal(upd.status, 200, JSON.stringify(upd.data));
    assert.ok(!(await queue('all')).items.some((/** @type {any} */ i) => i.id === e.id));
    assert.equal((await admin.get(`/posts/${post.data.id}`)).data.event_id, e.id);
  });
});
