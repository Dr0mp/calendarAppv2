// The permission matrix (spec §3.2), generated as a table-driven test.
// Each row: [method, path, body, expected status per actor]. Rows are added
// milestone by milestone as endpoints appear.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client } from './harness.js';

/** @type {Awaited<ReturnType<typeof startApp>>} */
let t;
/** @type {Record<string, Client>} */
const actors = {};

before(async () => {
  t = await startApp();
  actors.anon = new Client(t.http, '10.9.0.1');
  actors.user = await t.as('user', 'pm.user');
  actors.moderator = await t.as('moderator', 'pm.mod');
  actors.admin = await t.as('admin', 'pm.admin');
  actors.demo = new Client(t.http, '10.9.0.5');
  await actors.demo.demo('demo');
  actors.demo_admin = new Client(t.http, '10.9.0.6');
  await actors.demo_admin.demo('demo_admin');
});
after(() => t.close());

const ALL = ['anon', 'user', 'moderator', 'admin', 'demo', 'demo_admin'];

/**
 * @typedef {[string, string | (() => string), any, Record<string, number>]} Row
 * @type {Row[]}
 */
export const ACCOUNT_ROWS = [
  ['GET', '/me', undefined, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 200, demo_admin: 200 }],
  ['GET', '/me/sessions', undefined, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 200, demo_admin: 200 }],
  ['GET', '/me/passkeys', undefined, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 403, demo_admin: 403 }],
  ['POST', '/me/passkeys/options', {}, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 403, demo_admin: 403 }],
  ['DELETE', '/me/passkeys/nope', undefined, { anon: 401, user: 404, moderator: 404, admin: 404, demo: 403, demo_admin: 403 }],
  ['POST', '/me/password', { currentPassword: 'wrong', newPassword: 'a new pass phrase' },
    { anon: 401, user: 400, moderator: 400, admin: 400, demo: 403, demo_admin: 403 }],
  ['GET', '/me/counts', undefined, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 200, demo_admin: 200 }],
  ['GET', '/session', undefined, { anon: 200, user: 200, moderator: 200, admin: 200, demo: 200, demo_admin: 200 }],
];

/** @param {Row[]} rows */
export function runMatrix(rows) {
  for (const [method, path, body, expected] of rows) {
    for (const actor of ALL) {
      if (!(actor in expected)) continue;
      test(`${method} ${typeof path === 'string' ? path : 'dynamic'} as ${actor} → ${expected[actor]}`, async () => {
        const p = typeof path === 'function' ? path() : path;
        const r = await actors[actor].req(method, p, { body });
        assert.equal(r.status, expected[actor], JSON.stringify(r.data));
      });
    }
  }
}

const space = { name: 'Matrix', capacity_people: 5, color: 'owner-1', description: null, enabled: true };
const room = { name: 'Matrix', room_type: null, capacity_guests: 2, beds: null, color: 'owner-1', notes: null, enabled: true };

/** @type {Row[]} */
export const ADMIN_ROWS = [
  ['GET', '/spaces', undefined, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 200, demo_admin: 200 }],
  ['GET', '/rooms', undefined, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 200, demo_admin: 200 }],
  ['POST', '/spaces', space, { anon: 401, user: 403, moderator: 403, admin: 201, demo: 403, demo_admin: 201 }],
  ['POST', '/rooms', room, { anon: 401, user: 403, moderator: 403, admin: 201, demo: 403, demo_admin: 201 }],
  ['POST', '/spaces/reorder', { ids: ['00000000-0000-7000-8000-000000000000'] }, { anon: 401, user: 403, moderator: 403, admin: 200 }],
  ['GET', '/users/directory', undefined, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 200, demo_admin: 200 }],
  ['GET', '/users', undefined, { anon: 401, user: 403, moderator: 403, admin: 200, demo: 403, demo_admin: 200 }],
  ['POST', '/users', { name: 'M', username: 'matrix.x', email: 'mx@example.com', role: 'user' },
    { anon: 401, user: 403, moderator: 403, demo: 403, demo_admin: 403 }],
  ['GET', '/settings', undefined, { anon: 401, user: 403, moderator: 403, admin: 200, demo: 403, demo_admin: 200 }],
  ['PATCH', '/settings', { org_name: 'Casa Artis' }, { anon: 401, user: 403, moderator: 403, admin: 200, demo: 403, demo_admin: 403 }],
  ['POST', '/settings/test-email', {}, { anon: 401, user: 403, moderator: 403, demo: 403, demo_admin: 403 }],
  ['GET', '/admin/summary', undefined, { anon: 401, user: 403, moderator: 403, admin: 200, demo: 403, demo_admin: 200 }],
];

const future = '2099-06-01';
/** Entry fixtures created before the matrix runs (ids filled in `before`). */
const fx = { userEntry: '', adminEntry: '', room: '' };
const blocked = (d) => ({ type: 'blocked', title: 'Matrix', space_id: null, sessions: [{ date: d, start: '10:00', end: '11:00' }] });

/** @type {Row[]} */
export const ENTRY_ROWS = [
  ['GET', `/entries?from=${future}&to=2099-06-30`, undefined, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 200, demo_admin: 200 }],
  ['GET', () => `/entries/${fx.userEntry}`, undefined, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 404, demo_admin: 404 }],
  ['POST', '/entries', { entry: blocked('2099-06-02') }, { anon: 401 }],
  ['POST', '/entries', { entry: { type: 'room_only', title: 'M', sessions: [], room_bookings: [] } }, { anon: 401, user: 403, demo: 403 }],
  ['PATCH', () => `/entries/${fx.adminEntry}`, blocked('2099-06-03'), { anon: 401, user: 428, moderator: 428 }],
  ['POST', () => `/entries/${fx.userEntry}/reassign`, { ownerId: '00000000-0000-7000-8000-000000000000' }, { anon: 401, user: 403, moderator: 403, demo: 404, demo_admin: 404 }],
  ['PUT', () => `/entries/${fx.userEntry}/room-bookings`, { room_bookings: [] }, { anon: 401, user: 403 }],
  ['POST', '/availability', { type: 'event', sessions: [] }, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 200, demo_admin: 200 }],
  ['GET', '/me/counts', undefined, { anon: 401, user: 200, admin: 200 }],
  ['POST', '/series/preview', { rule: { freq: 'weekly', count: 2 }, sessions: [{ date: '2099-06-01', start: '10:00', end: '11:00' }] },
    { anon: 401, user: 200, moderator: 200, admin: 200, demo: 200, demo_admin: 200 }],
  ['GET', '/series/00000000-0000-7000-8000-000000000000', undefined, { anon: 401, user: 404, admin: 404 }],
];

describe('account endpoints', () => runMatrix(ACCOUNT_ROWS));
describe('entries', () => {
  before(async () => {
    fx.userEntry = (await actors.user.post('/entries', { entry: blocked('2099-06-10') })).data.id;
    fx.adminEntry = (await actors.admin.post('/entries', { entry: blocked('2099-06-11') })).data.id;
  });
  runMatrix(ENTRY_ROWS);
  test('edit and delete: own only for users and moderators, any for admins', async () => {
    const other = (await actors.admin.get(`/entries/${fx.adminEntry}`)).data;
    for (const who of ['user', 'moderator']) {
      assert.equal((await actors[who].patch(`/entries/${fx.adminEntry}`, blocked('2099-06-11'), other.version)).status, 403, who);
      assert.equal((await actors[who].del(`/entries/${fx.adminEntry}`, other.version)).status, 403, who);
    }
    const mine = (await actors.user.get(`/entries/${fx.userEntry}`)).data;
    assert.equal((await actors.admin.patch(`/entries/${fx.userEntry}`, blocked('2099-06-12'), mine.version)).status, 200);
    assert.equal((await actors.user.del(`/entries/${fx.userEntry}`, mine.version + 1)).status, 200);
  });
});
describe('venues, users and settings', () => runMatrix(ADMIN_ROWS));

export const MEDIA_ROWS = /** @type {Row[]} */ ([
  ['GET', '/api/v1/media', undefined, { anon: 401, user: 200, moderator: 200, admin: 200, demo: 200, demo_admin: 200 }],
  ['GET', '/api/v1/media/sample-cover', undefined, { anon: 401, user: 404, moderator: 404, admin: 404, demo: 200, demo_admin: 200 }],
  ['GET', '/api/v1/media/nope', undefined, { anon: 401, user: 404, moderator: 404, admin: 404, demo: 404, demo_admin: 404 }],
  ['POST', '/api/v1/media/nope/crop', { x: 0, y: 0, w: 16, h: 9 }, { anon: 401, user: 404, moderator: 404, admin: 404, demo: 404, demo_admin: 404 }],
]);

describe('media', () => runMatrix(MEDIA_ROWS));

export const SOCIAL_ROWS = /** @type {Row[]} */ ([
  ['GET', '/platforms', undefined, { anon: 401, user: 403, moderator: 403, admin: 200, demo: 403, demo_admin: 200 }],
  ['POST', '/platforms/reset', {}, { anon: 401, user: 403, moderator: 403, admin: 200, demo: 403, demo_admin: 200 }],
  ['GET', '/posts', undefined, { anon: 401, user: 403, moderator: 403, admin: 200, demo: 403, demo_admin: 200 }],
  ['POST', '/posts', {}, { anon: 401, user: 403, moderator: 403, admin: 400, demo: 403, demo_admin: 400 }],
  ['GET', '/social/export', undefined, { anon: 401, user: 403, moderator: 403, admin: 200, demo: 403, demo_admin: 200 }],
  ['GET', '/promotions', undefined, { anon: 401, user: 403, moderator: 403, admin: 200, demo: 403, demo_admin: 200 }],
  ['POST', '/promotions/01900000-0000-7000-8000-000000000000/skip', undefined, { anon: 401, user: 403, moderator: 403, admin: 404, demo: 403, demo_admin: 404 }],
]);

describe('social and promotions', () => runMatrix(SOCIAL_ROWS));
