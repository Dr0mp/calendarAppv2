import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client } from './harness.js';

/** @type {Awaited<ReturnType<typeof startApp>>} */
let t;
/** @type {any} */ let admin;
before(async () => {
  t = await startApp();
  admin = await t.as('admin', 'boss');
});
after(() => t.close());

describe('spaces and rooms', () => {
  test('seeded venues are listed in order with upcoming counts', async () => {
    const s = await admin.get('/spaces');
    assert.equal(s.data.items.length, 2);
    assert.equal(s.data.items[0].name, 'Sala Mare (Conferințe & Evenimente)');
    assert.equal(s.data.items[0].capacity_people, 80);
    assert.ok(s.data.items[0].upcoming >= 1);
    const r = await admin.get('/rooms');
    assert.equal(r.data.items[1].room_type, 'Twin');
    assert.ok(r.data.items[1].upcoming >= 1, 'counts come from room_bookings');
  });

  test('create, update with If-Match, reorder, delete', async () => {
    const c = await admin.post('/spaces', { name: 'Sala Mică', capacity_people: 20, color: 'owner-3', description: 'Pian', enabled: true });
    assert.equal(c.status, 201);
    assert.equal(c.headers.get('etag'), 'W/"1"');
    const id = c.data.id;
    assert.equal((await admin.patch(`/spaces/${id}`, { capacity_people: 25 })).status, 428);
    const u = await admin.patch(`/spaces/${id}`, { capacity_people: 25, enabled: false }, 1);
    assert.equal(u.data.capacity_people, 25);
    assert.equal(u.data.enabled, false);
    assert.equal((await admin.patch(`/spaces/${id}`, { name: 'X' }, 1)).status, 409);
    const order = await admin.post('/spaces/reorder', { ids: [id] });
    assert.equal(order.data.items[0].id, id);
    assert.equal((await admin.del(`/spaces/${id}`, 2)).status, 200);
    assert.equal((await admin.get(`/spaces/${id}`)).status, 404);
  });

  test('a space in use cannot be deleted', async () => {
    const s = (await admin.get('/spaces')).data.items[0];
    const r = await admin.del(`/spaces/${s.id}`, s.version);
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'in_use');
  });

  test('validation', async () => {
    const r = await admin.post('/rooms', { name: '', capacity_guests: 0, color: '#fff', enabled: true });
    assert.equal(r.status, 400);
    assert.deepEqual(Object.keys(r.data.error.details.fields).sort(), ['color', 'name', 'capacity_guests'].sort());
  });
});

describe('users', () => {
  test('invite: email off returns a copyable link; email on sends it', async () => {
    const r = await admin.post('/users', { name: 'Elena Nouă', username: 'elena', email: 'elena@example.com', role: 'moderator' });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.status, 'invited');
    assert.equal(r.data.emailed, true);
    assert.equal(t.outbox().at(-1).to, 'elena@example.com');
    const copy = await admin.post(`/users/${r.data.user.id}/invite`, { send: false });
    assert.match(copy.data.link, /\/invite\/[\w-]{43}$/);
    const accept = await new Client(t.http, '10.8.0.9').post(`/auth/token/${copy.data.link.split('/').pop()}`, { password: 'o parolă bună și lungă' });
    assert.equal(accept.status, 200);
    assert.equal(accept.data.user.role, 'moderator');
    // the first link was invalidated by the fresh one
    const first = t.outbox().at(-1).text.match(/\/invite\/(\S+)/)[1];
    assert.equal((await new Client(t.http).get(`/auth/token/${first}`)).status, 404);
  });

  test('duplicate usernames (any case) and emails are refused', async () => {
    const a = await admin.post('/users', { name: 'X', username: 'boss', email: 'x1@example.com', role: 'user' });
    assert.equal(a.data.error.code, 'username_taken');
    const b = await admin.post('/users', { name: 'X', username: 'bad name', email: 'x2@example.com', role: 'user' });
    assert.equal(b.data.error.details.fields.username, 'invalid_username');
  });

  test('list shows real users only; directory for everyone', async () => {
    const list = await admin.get('/users');
    assert.ok(list.data.items.every((/** @type {any} */ u) => !u.isDemo && !u.isSeed));
    const root = list.data.items.find((/** @type {any} */ u) => u.isRoot);
    assert.equal(root.username, 'admin');
    const user = await t.as('user');
    const dir = await user.get('/users/directory');
    assert.ok(dir.data.items.length > 1);
    assert.deepEqual(Object.keys(dir.data.items[0]).sort(), ['color', 'id', 'initials', 'name', 'role']);
    assert.equal((await user.get('/users')).status, 403);
  });

  test('edit: role change revokes sessions; the root admin cannot be demoted', async () => {
    const victim = await t.as('user', 'promoted');
    const row = (await admin.get(`/users/${victim.user.id}`)).data;
    const r = await admin.patch(`/users/${victim.user.id}`, { role: 'moderator', color: 'owner-12', initials: 'PR' }, row.version);
    assert.equal(r.status, 200);
    assert.equal(r.data.role, 'moderator');
    assert.equal(r.data.initials, 'PR');
    assert.equal((await victim.get('/me')).status, 401);
    const root = (await admin.get('/users')).data.items.find((/** @type {any} */ u) => u.isRoot);
    const d = await admin.patch(`/users/${root.id}`, { role: 'user' }, root.version);
    assert.equal(d.data.error.code, 'root_protected');
  });

  test('disable blocks sign-in and revokes sessions; enable restores', async () => {
    const u = await t.as('user', 'toggle');
    let row = (await admin.get(`/users/${u.user.id}`)).data;
    row = (await admin.patch(`/users/${u.user.id}`, { status: 'disabled' }, row.version)).data;
    assert.equal(row.status, 'disabled');
    assert.equal((await u.get('/me')).status, 401);
    assert.equal((await new Client(t.http, '10.8.1.1').post('/auth/login', { username: 'toggle', password: 'correct horse battery staple' })).status, 401);
    row = (await admin.patch(`/users/${u.user.id}`, { status: 'active' }, row.version)).data;
    assert.equal(row.status, 'active');
    assert.equal((await new Client(t.http, '10.8.1.2').post('/auth/login', { username: 'toggle', password: 'correct horse battery staple' })).status, 200);
    const self = (await admin.get(`/users/${admin.user.id}`)).data;
    assert.equal((await admin.patch(`/users/${admin.user.id}`, { status: 'disabled' }, self.version)).data.error.code, 'cannot_disable_self');
  });

  test('reset link: copy or send; admin never sees a password', async () => {
    const u = await t.as('user', 'resettable');
    const r = await admin.post(`/users/${u.user.id}/reset-link`, { send: false });
    assert.match(r.data.link, /\/reset\//);
    const sent = await admin.post(`/users/${u.user.id}/reset-link`, {});
    assert.equal(sent.data.emailed, true);
    const row = (await admin.get(`/users/${u.user.id}`)).data;
    assert.equal('password_hash' in row, false);
  });

  test('remove passkeys and revoke sessions', async () => {
    const u = await t.as('user', 'revokee');
    assert.equal((await admin.del(`/users/${u.user.id}/sessions`)).data.removed, 1);
    assert.equal((await u.get('/me')).status, 401);
    assert.equal((await admin.del(`/users/${u.user.id}/passkeys`)).status, 200);
  });

  test('delete: root, self and users with upcoming entries need care', async () => {
    const root = (await admin.get('/users')).data.items.find((/** @type {any} */ u) => u.isRoot);
    assert.equal((await admin.req('DELETE', `/users/${root.id}`, { body: {}, version: root.version })).data.error.code, 'root_protected');
    const me = (await admin.get(`/users/${admin.user.id}`)).data;
    assert.equal((await admin.req('DELETE', `/users/${admin.user.id}`, { body: {}, version: me.version })).data.error.code, 'cannot_delete_self');

    // Give a user an upcoming and a past entry.
    const owner = await t.user({ username: 'leaving', name: 'Plecat Temporar' });
    const db = t.app.workspaces.main.db;
    const mk = (id, date) =>
      db.prepare(`INSERT INTO entries (id, type, title, owner_id, owner_name_snapshot, first_date, last_date, created_at, updated_at)
        VALUES (?, 'blocked', 'x', ?, 'Plecat Temporar', ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`).run(id, owner.id, date, date);
    mk('00000000-0000-7000-8000-000000000001', '2099-01-01');
    mk('00000000-0000-7000-8000-000000000002', '2020-01-01');
    let row = (await admin.get(`/users/${owner.id}`)).data;
    const refused = await admin.req('DELETE', `/users/${owner.id}`, { body: {}, version: row.version });
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error.code, 'has_upcoming_entries');
    const ok = await admin.req('DELETE', `/users/${owner.id}`, { body: { transferTo: admin.user.id, keepPast: true }, version: row.version });
    assert.equal(ok.status, 200);
    const [up, past] = /** @type {any[]} */ (db.prepare("SELECT owner_id, owner_name_snapshot FROM entries WHERE id IN ('00000000-0000-7000-8000-000000000001','00000000-0000-7000-8000-000000000002') ORDER BY id").all());
    assert.equal(up.owner_id, admin.user.id);
    assert.equal(past.owner_id, owner.id, 'past entries keep the former owner');
    assert.equal(past.owner_name_snapshot, 'Plecat Temporar');
    assert.equal((await admin.get(`/users/${owner.id}`)).status, 404);
    // Re-using the username never links the new user to the old entries.
    const again = await t.user({ username: 'leaving' });
    assert.notEqual(again.id, owner.id);
  });

  test('transfer root', async () => {
    const other = await t.as('admin', 'heir');
    const root = (await admin.get('/users')).data.items.find((/** @type {any} */ u) => u.isRoot);
    // only the root may hand over
    assert.equal((await admin.post(`/users/${other.user.id}/transfer-root`, {})).data.error.code, 'root_only');
    t.app.authDb.prepare('UPDATE users SET is_root = 0 WHERE id = ?').run(root.id);
    t.app.authDb.prepare('UPDATE users SET is_root = 1 WHERE id = ?').run(admin.user.id);
    assert.equal((await admin.post(`/users/${other.user.id}/transfer-root`, {})).status, 200);
    const after = (await admin.get('/users')).data.items.filter((/** @type {any} */ u) => u.isRoot);
    assert.deepEqual(after.map((/** @type {any} */ u) => u.id), [other.user.id]);
  });

  test('GDPR export', async () => {
    const u = await t.as('user', 'exported');
    const r = await admin.get(`/users/${u.user.id}/export`);
    assert.equal(r.status, 200);
    assert.equal(r.data.profile.username, 'exported');
    assert.ok(Array.isArray(r.data.entries));
    assert.equal('password_hash' in r.data.profile, false);
  });
});

describe('demo isolation for users', () => {
  test('demo admin sees only demo and seed users; real users stay hidden', async () => {
    const d = new Client(t.http, '10.8.9.1');
    await d.demo('demo_admin');
    const list = (await d.get('/users')).data.items;
    assert.ok(list.length >= 4);
    assert.ok(list.every((/** @type {any} */ u) => u.isDemo || u.isSeed));
    const dir = (await d.get('/users/directory')).data.items;
    assert.ok(!dir.some((/** @type {any} */ u) => u.name === 'boss'));
    const real = (await admin.get('/users')).data.items[0];
    assert.equal((await d.get(`/users/${real.id}`)).status, 404);
    assert.equal((await d.patch(`/users/${real.id}`, { name: 'x' }, real.version)).status, 404);
  });

  test('demo admin invites, edits and deletes demo-only people who sign in to the demo only', async () => {
    const d = new Client(t.http, '10.8.9.2');
    await d.demo('demo_admin');
    // Invite: a demo-only person gets the normal invite link.
    const r = await d.post('/users', { name: 'Maria Test', username: 'maria.test', role: 'moderator' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.demo, true);
    assert.match(r.data.link, /\/invite\/[\w-]{43}$/);
    const maria = r.data.user;
    assert.equal(maria.username, 'seed.maria.test');
    assert.deepEqual([maria.isSeed, maria.status, maria.role], [true, 'invited', 'moderator']);
    // With an email, the invitation is sent.
    const withMail = await d.post('/users', { name: 'Boss', username: 'boss', email: 'boss.demo@example.com', role: 'user' });
    assert.equal(withMail.data.emailed, true);
    assert.equal(t.outbox().at(-1).to, 'boss.demo@example.com');
    // A username a real account uses is never revealed: the demo one just differs.
    assert.equal(withMail.data.user.username, 'seed.boss');
    // Real admins never see demo people.
    assert.ok(!(await admin.get('/users')).data.items.some((/** @type {any} */ u) => u.id === maria.id));

    // The link sets a password and signs in to the demo; later password logins land in the demo too.
    const PW = 'o parolă bună și lungă pentru demo';
    const accept = await new Client(t.http, '10.8.9.5').post(`/auth/token/${r.data.link.split('/').pop()}`, { password: PW });
    assert.equal(accept.status, 200, JSON.stringify(accept.data));
    assert.equal(accept.data.workspace, 'demo');
    const m = new Client(t.http, '10.8.9.6');
    assert.equal((await m.login('seed.maria.test', PW)).data.workspace, 'demo');
    assert.ok((await m.get('/users')).status < 500);

    // Edit and disable.
    const cur = (await d.get(`/users/${maria.id}`)).data;
    const e1 = await d.patch(`/users/${maria.id}`, { name: 'Maria Ionescu', role: 'user', color: 'owner-3', email: 'maria@example.com' }, cur.version);
    assert.equal(e1.status, 200, JSON.stringify(e1.data));
    assert.deepEqual([e1.data.name, e1.data.email], ['Maria Ionescu', 'maria@example.com']);
    assert.equal((await d.patch(`/users/${maria.id}`, { username: 'other' }, e1.data.version)).data.error.code, 'demo_forbidden');
    assert.equal((await d.post(`/users/${maria.id}/reset-link`, { send: false })).status, 200);
    assert.equal((await d.req('DELETE', `/users/${maria.id}/sessions`)).status, 200);
    const e2 = await d.patch(`/users/${maria.id}`, { status: 'disabled' }, (await d.get(`/users/${maria.id}`)).data.version);
    assert.equal(e2.data.status, 'disabled');
    assert.equal((await new Client(t.http, '10.8.9.7').post('/auth/login', { username: 'seed.maria.test', password: PW })).status, 401);

    // Demo accounts stay locked, and real people are out of reach.
    const me = (await d.get('/users')).data.items.find((/** @type {any} */ u) => u.username === 'demo');
    assert.equal((await d.patch(`/users/${me.id}`, { name: 'x' }, me.version)).data.error.code, 'demo_forbidden');
    assert.equal((await d.post(`/users/${me.id}/reset-link`, {})).status, 403);

    // A sample person with upcoming demo entries needs a transfer, inside the demo.
    const anca = (await d.get('/users')).data.items.find((/** @type {any} */ u) => u.username === 'seed.anca');
    if (anca.upcoming > 0) {
      assert.equal((await d.req('DELETE', `/users/${anca.id}`, { version: anca.version, body: {} })).data.error.code, 'has_upcoming_entries');
    }
    const alex = (await d.get('/users')).data.items.find((/** @type {any} */ u) => u.username === 'seed.alex');
    assert.equal((await d.req('DELETE', `/users/${anca.id}`, { version: anca.version, body: { transferTo: maria.id } })).data.error.code, 'transfer_target_invalid', 'disabled');
    const del = await d.req('DELETE', `/users/${anca.id}`, { version: anca.version, body: { transferTo: alex.id } });
    assert.equal(del.status, 200, JSON.stringify(del.data));

    // The demo reset removes added people and restores the sample ones.
    await t.app.resetDemo();
    const d2 = new Client(t.http, '10.8.9.4');
    await d2.demo('demo_admin');
    const names = (await d2.get('/users')).data.items.map((/** @type {any} */ u) => u.username).sort();
    assert.ok(names.includes('seed.anca'), 'sample person restored');
    assert.ok(!names.includes('seed.maria.test') && !names.includes('seed.boss'), 'added people removed');
  });
});

describe('settings', () => {
  test('read and update; time zone validated; cap bounded by the environment', async () => {
    const s = await admin.get('/settings');
    assert.equal(s.data.tz, 'Europe/Bucharest');
    assert.equal(s.data.email.configured, true);
    assert.equal((await admin.patch('/settings', { tz: 'Mars/Base' })).data.error.details.fields.tz, 'invalid_timezone');
    assert.equal((await admin.patch('/settings', { storage_cap_bytes: 9e12 })).status, 400);
    const u = await admin.patch('/settings', { org_name: 'Casa Artis Test', storage_cap_bytes: 1024 ** 3 });
    assert.equal(u.data.org_name, 'Casa Artis Test');
    assert.equal(u.data.storage_cap_bytes, 1024 ** 3);
    assert.equal((await admin.get('/session')).data.settings.orgName, 'Casa Artis Test');
  });

  test('changing the zone recomputes session instants', async () => {
    const db = t.app.workspaces.main.db;
    const before = /** @type {any} */ (db.prepare('SELECT id, start_utc FROM entry_sessions LIMIT 1').get());
    await admin.patch('/settings', { tz: 'UTC' });
    const after = /** @type {any} */ (db.prepare('SELECT start_utc FROM entry_sessions WHERE id = ?').get(before.id));
    assert.notEqual(after.start_utc, before.start_utc);
    await admin.patch('/settings', { tz: 'Europe/Bucharest' });
  });

  test('test email and demo reset', async () => {
    const r = await admin.post('/settings/test-email', {});
    assert.equal(r.data.to, 'boss@example.com');
    assert.equal((await admin.post('/settings/demo-reset', {})).status, 200);
    const d = new Client(t.http, '10.8.9.2');
    await d.demo('demo_admin');
    assert.equal((await d.patch('/settings', { org_name: 'Hack' })).status, 403);
    assert.equal((await d.get('/settings')).data.workspace, 'demo');
  });
});
