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

describe('account endpoints', () => runMatrix(ACCOUNT_ROWS));
describe('venues, users and settings', () => runMatrix(ADMIN_ROWS));
