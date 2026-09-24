import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client, TEST_TOKEN } from './harness.js';

/** @type {Awaited<ReturnType<typeof startApp>>} */
let t;
before(async () => {
  t = await startApp();
});
after(() => t.close());

const PW = 'correct horse battery staple';

describe('platform', () => {
  test('health and security headers', async () => {
    const r = await t.http.request('/api/v1/health');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, version: '2.0.0' });
    const page = await t.http.request('/login');
    const csp = page.headers.get('content-security-policy') ?? '';
    assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+' https:\/\/esm\.sh/);
    assert.match(csp, /style-src 'self';/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin');
    const html = await page.text();
    assert.match(html, /<script type="importmap">/);
    // Only the import map (hashed in the CSP), the module entry and a JSON data block (not executable).
    assert.equal((html.match(/<script(?![^>]*type="(module|importmap|application\/json)")/g) ?? []).length, 0, 'no other inline script');
  });

  test('the page embeds the session and preloads the modules of the route', async () => {
    const html = await (await t.http.request('/calendar')).text();
    const data = JSON.parse(html.match(/<script type="application\/json" id="session-data">(.*?)<\/script>/s)?.[1] ?? 'null');
    assert.equal(data.user, null);
    assert.equal(data.settings.tz, 'Europe/Bucharest');
    for (const m of ['/app/main.js', '/app/shell.js', '/app/pages/calendar/calendar.js', '/shared/rules/time.js']) {
      assert.ok(html.includes(`<link rel="modulepreload" href="${m}" />`), m);
    }
    assert.ok(!html.includes('/app/pages/schedule/schedule.js'), 'only this route');
    assert.match(html, /<link rel="preload" href="\/app\/i18n\/ro\.json" as="fetch" crossorigin \/>/);
    const schedule = await (await t.http.request('/schedule')).text();
    assert.ok(schedule.includes('/app/pages/schedule/schedule.js'));
    assert.ok(!schedule.includes('"/shared/schemas/entry.js"'), 'Zod loads after the first paint');
  });

  test('static text is compressed, and each file keeps its own bytes', async () => {
    const zlib = await import('node:zlib');
    const fs = await import('node:fs');
    const get = (/** @type {string} */ p, /** @type {string} */ enc) => t.http.request(p, { headers: { 'accept-encoding': enc } });
    for (const p of ['/app/components/ui.js', '/app/shell.js', '/app/pages/calendar/calendar.js']) {
      const r = await get(p, 'br, gzip');
      assert.equal(r.headers.get('content-encoding'), 'br');
      assert.equal(r.headers.get('vary'), 'Accept-Encoding');
      const body = zlib.brotliDecompressSync(Buffer.from(await r.arrayBuffer())).toString('utf8');
      assert.equal(body, fs.default.readFileSync(`public${p}`, 'utf8'), p);
    }
    // Two files with the same size and time (e.g. vendored locales) must never share a cache entry.
    const [f1, f2] = ['public/app/__same-a.js', 'public/app/__same-b.js'];
    try {
      fs.default.writeFileSync(f1, `export const a = '${'a'.repeat(3000)}';\n`);
      fs.default.writeFileSync(f2, `export const b = '${'b'.repeat(3000)}';\n`);
      const when = new Date('2026-01-01T00:00:00Z');
      fs.default.utimesSync(f1, when, when);
      fs.default.utimesSync(f2, when, when);
      for (const [f, ch] of [[f1, 'a'], [f2, 'b']]) {
        const r = await get(`/${f.slice('public/'.length)}`, 'br');
        assert.ok(zlib.brotliDecompressSync(Buffer.from(await r.arrayBuffer())).toString('utf8').includes(ch.repeat(100)), f);
      }
    } finally {
      fs.default.rmSync(f1, { force: true });
      fs.default.rmSync(f2, { force: true });
    }
    const gz = await get('/styles/app.css', 'gzip');
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    const css = zlib.gunzipSync(Buffer.from(await gz.arrayBuffer())).toString('utf8');
    assert.ok(css.indexOf('@layer reset, tokens') < css.indexOf('/* utilities.css */'), 'tokens first, utilities last');
    const plain = await get('/app/api.js', '');
    assert.equal(plain.headers.get('content-encoding'), null);
    const etag = plain.headers.get('etag') ?? '';
    assert.equal((await t.http.request('/app/api.js', { headers: { 'if-none-match': etag } })).status, 304);
  });

  test('the import-map hash in the CSP matches the inline map', async () => {
    const page = await t.http.request('/calendar');
    const html = await page.text();
    const map = html.match(/<script type="importmap">(.*?)<\/script>/s)?.[1] ?? '';
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(map).digest('base64');
    assert.ok(page.headers.get('content-security-policy')?.includes(`'sha256-${hash}'`));
  });

  test('unknown API routes are JSON 404', async () => {
    const r = await new Client(t.http).get('/nope');
    assert.equal(r.status, 404);
    assert.equal(r.data.error.code, 'not_found');
  });

  test('static files are served, traversal is refused', async () => {
    assert.equal((await t.http.request('/app/main.js')).status, 200);
    assert.equal((await t.http.request('/shared/rules/time.js')).status, 200);
    assert.equal((await t.http.request('/shared/../server/config.js')).status, 404);
    assert.equal((await t.http.request('/app/%2e%2e/%2e%2e/server/config.js')).status, 404);
    assert.equal((await t.http.request('/missing.js')).status, 404);
  });

  test('anonymous session', async () => {
    const r = await new Client(t.http).get('/session');
    assert.equal(r.data.user, null);
    assert.equal(r.data.csrfToken, null);
    assert.equal(r.data.settings.tz, 'Europe/Bucharest');
    assert.equal(r.data.features.demo, true);
  });
});

describe('bootstrap and invitations', () => {
  test('the root admin accepts the setup link', async () => {
    assert.ok(t.setupLink, 'a setup link is printed on first run');
    const token = t.setupLink.split('/invite/')[1];
    const c = new Client(t.http, '10.1.0.1');
    const info = await c.get(`/auth/token/${token}`);
    assert.equal(info.status, 200);
    assert.equal(info.data.purpose, 'invite');
    assert.equal(info.data.user.username, 'admin');

    for (const [pw, code] of [
      ['short', 'password_too_short'],
      ['Unbelievable', 'password_common'],
      ['my admin password!', 'password_contains_personal'],
      ['casa artis rocks 2026', 'password_contains_personal'],
    ]) {
      const r = await c.post(`/auth/token/${token}`, { password: pw });
      assert.equal(r.status, 400, pw);
      assert.equal(r.data.error.code, code, pw);
    }
    const ok = await c.post(`/auth/token/${token}`, { password: PW });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.username, 'admin');
    assert.equal(ok.data.user.isRoot, true);
    assert.ok(ok.data.csrfToken);
    // single use
    assert.equal((await new Client(t.http).post(`/auth/token/${token}`, { password: PW })).status, 404);
    assert.equal((await new Client(t.http).get(`/auth/token/${token}`)).status, 404);
  });

  test('a garbage token is rejected', async () => {
    const c = new Client(t.http);
    assert.equal((await c.get('/auth/token/abc')).status, 404);
    assert.equal((await c.get(`/auth/token/${'x'.repeat(43)}`)).status, 404);
  });
});

describe('password sign-in', () => {
  test('wrong password and unknown user give the same generic error', async () => {
    await t.user({ username: 'ana', password: PW });
    const c = new Client(t.http, '10.2.0.1');
    const a = await c.post('/auth/login', { username: 'ana', password: 'nope nope nope' });
    const b = await c.post('/auth/login', { username: 'ghost', password: 'nope nope nope' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.data.error.code, 'invalid_credentials');
    assert.deepEqual(a.data, b.data);
  });

  test('usernames are case-insensitive, passwords are not trimmed', async () => {
    await t.user({ username: 'bogdan', password: ' spaced password here ' });
    const c = new Client(t.http, '10.2.0.2');
    assert.equal((await c.post('/auth/login', { username: 'bogdan', password: 'spaced password here' })).status, 401);
    const r = await c.post('/auth/login', { username: 'BOGDAN', password: ' spaced password here ' });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.username, 'bogdan');
    assert.equal(r.data.workspace, 'main');
  });

  test('the session cookie is HttpOnly, SameSite=Lax', async () => {
    await t.user({ username: 'cookie.check', password: PW });
    const r = await t.http.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-forwarded-for': '10.2.0.3' },
      body: JSON.stringify({ username: 'cookie.check', password: PW }),
    });
    const cookie = r.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^sid=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
  });

  test('increasing delay after 5 failures per username+IP; only failures count', async () => {
    await t.user({ username: 'lockme', password: PW });
    const c = new Client(t.http, '10.3.0.1');
    // successes don't count
    for (let i = 0; i < 6; i++) await c.login('lockme', PW);
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/auth/login', { username: 'lockme', password: 'wrong wrong wrong' })).status, 401);
    const blocked = await c.post('/auth/login', { username: 'lockme', password: PW });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    // another IP is not affected
    assert.equal((await new Client(t.http, '10.3.0.2').post('/auth/login', { username: 'lockme', password: PW })).status, 200);
  });

  test('30 failed attempts per IP per 15 min', async () => {
    const c = new Client(t.http, '10.3.1.1');
    for (let i = 0; i < 30; i++) {
      assert.equal((await c.post('/auth/login', { username: `nobody${i}`, password: 'x' })).status, 401);
    }
    assert.equal((await c.post('/auth/login', { username: 'nobody-else', password: 'x' })).status, 429);
  });

  test('validation: unknown fields are rejected', async () => {
    const r = await new Client(t.http).post('/auth/login', { username: 'a', password: 'b', admin: true });
    assert.equal(r.status, 400);
    assert.equal(r.data.error.code, 'validation_error');
  });

  test('disabled users cannot sign in', async () => {
    const u = await t.user({ username: 'gone', password: PW });
    t.app.authDb.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(u.id);
    assert.equal((await new Client(t.http, '10.3.2.1').post('/auth/login', { username: 'gone', password: PW })).status, 401);
  });
});

describe('CSRF and Origin', () => {
  test('mutations need the session token and a known Origin', async () => {
    const c = await t.as('user');
    assert.equal((await c.post('/auth/logout-all', {}, { csrf: null })).data.error.code, 'csrf_invalid');
    assert.equal((await c.post('/auth/logout-all', {}, { csrf: 'wrong' })).status, 403);
    assert.equal((await c.post('/auth/logout-all', {}, { origin: 'https://evil.example' })).data.error.code, 'bad_origin');
    assert.equal((await c.post('/auth/logout-all', {}, { origin: null })).data.error.code, 'bad_origin');
    const ok = await c.req('PATCH', '/me', { body: { theme: 'dark' }, version: c.user.version, headers: { referer: 'http://localhost:3000/account' }, origin: null });
    assert.equal(ok.status, 200);
  });

  test('pre-sign-in requests still need the Origin', async () => {
    const r = await new Client(t.http).post('/auth/forgot', { login: 'x' }, { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
  });
});

describe('sessions', () => {
  test('logout deletes the server session', async () => {
    const c = await t.as('user');
    const cookie = new Map(c.cookies);
    assert.equal((await c.post('/auth/logout', {})).status, 200);
    const replay = new Client(t.http);
    replay.cookies = cookie;
    assert.equal((await replay.get('/session')).data.user, null);
  });

  test('logout-all revokes every session', async () => {
    const a = await t.as('user', 'multi');
    const b = new Client(t.http, '10.4.0.2');
    await b.login('multi', PW);
    assert.equal((await b.get('/me/sessions')).data.items.length, 2);
    await a.post('/auth/logout-all', {});
    assert.equal((await b.get('/me')).status, 401);
  });

  test('list and revoke one session', async () => {
    const a = await t.as('user', 'two.devices');
    const b = new Client(t.http, '10.4.1.2');
    await b.login('two.devices', PW);
    const list = (await a.get('/me/sessions')).data.items;
    const other = list.find((/** @type {any} */ s) => !s.current);
    assert.equal((await a.del(`/me/sessions/${other.id}`)).status, 200);
    assert.equal((await b.get('/me')).status, 401);
    assert.equal((await a.del(`/me/sessions/${other.id}`)).status, 404);
  });

  test('idle and absolute expiry', async () => {
    const c = await t.as('user');
    t.app.authDb.prepare("UPDATE sessions SET last_seen_at = '2020-01-01T00:00:00Z'").run();
    assert.equal((await c.get('/me')).status, 401);
  });
});

describe('forgot password and reset', () => {
  test('always the same answer; email for real accounts only; reset revokes sessions', async () => {
    const victim = await t.as('user', 'forgetful');
    const before = t.outbox().length;
    const c = new Client(t.http, '10.5.0.1');
    const a = await c.post('/auth/forgot', { login: 'forgetful' });
    const b = await c.post('/auth/forgot', { login: 'does-not-exist' });
    assert.equal(a.status, 202);
    assert.deepEqual(a.data, b.data);
    const mails = t.outbox().slice(before);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'forgetful@example.com');
    const link = mails[0].text.match(/\/reset\/(\S+)/)?.[1];
    assert.ok(link);
    const done = await new Client(t.http).post(`/auth/token/${link}`, { password: 'a brand new pass phrase' });
    assert.equal(done.status, 200);
    assert.equal((await victim.get('/me')).status, 401, 'old sessions are revoked');
    assert.equal((await new Client(t.http, '10.5.0.3').post('/auth/login', { username: 'forgetful', password: 'a brand new pass phrase' })).status, 200);
    assert.equal((await new Client(t.http).post(`/auth/token/${link}`, { password: 'another new pass phrase' })).status, 404);
  });

  test('rate limit: 5 per hour per IP', async () => {
    const c = new Client(t.http, '10.5.1.1');
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/auth/forgot', { login: `x${i}` })).status, 202);
    assert.equal((await c.post('/auth/forgot', { login: 'x' })).status, 429);
  });
});

describe('account (me)', () => {
  test('profile update with If-Match and version conflicts', async () => {
    const c = await t.as('user');
    const me = (await c.get('/me')).data;
    assert.equal((await c.patch('/me', { name: 'Nume Nou' })).status, 428);
    const r = await c.patch('/me', { name: 'Nume Nou', locale: 'en', theme: 'dark' }, me.version);
    assert.equal(r.status, 200);
    assert.equal(r.data.name, 'Nume Nou');
    assert.equal(r.headers.get('etag'), `W/"${me.version + 1}"`);
    const stale = await c.patch('/me', { name: 'Altul' }, me.version);
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error.code, 'version_conflict');
    assert.equal(stale.data.error.details.current, me.version + 1);
    assert.equal((await c.patch('/me', { role: 'admin' }, me.version + 1)).status, 400);
  });

  test('change password needs the current one and revokes other sessions', async () => {
    const a = await t.as('user', 'changer');
    const b = new Client(t.http, '10.6.0.2');
    await b.login('changer', PW);
    assert.equal((await a.post('/me/password', { currentPassword: 'wrong', newPassword: 'new pass phrase here' })).data.error.code, 'wrong_current_password');
    assert.equal((await a.post('/me/password', { currentPassword: PW, newPassword: 'short' })).data.error.code, 'password_too_short');
    const r = await a.post('/me/password', { currentPassword: PW, newPassword: 'new pass phrase here' });
    assert.equal(r.status, 200);
    a.csrf = r.data.csrfToken;
    assert.equal((await b.get('/me')).status, 401);
    assert.equal((await a.get('/me')).status, 200, 'this device keeps a fresh session');
  });

  test('passkey endpoints: options and failures', async () => {
    const c = await t.as('user');
    const opts = await c.post('/me/passkeys/options', {});
    assert.equal(opts.status, 200);
    assert.equal(opts.data.authenticatorSelection.residentKey, 'required');
    assert.equal(opts.data.authenticatorSelection.userVerification, 'required');
    assert.equal((await c.post('/me/passkeys', { response: { id: 'x' } })).data.error.code, 'passkey_failed');
    assert.deepEqual((await c.get('/me/passkeys')).data.items, []);
    const login = await new Client(t.http, '10.6.1.1').post('/auth/passkey/options', {});
    assert.equal(login.data.userVerification, 'required');
    assert.deepEqual(login.data.allowCredentials, []);
    const bad = await new Client(t.http, '10.6.1.1').post('/auth/passkey/verify', { response: { id: 'x', response: {} } });
    assert.equal(bad.status, 401);
  });
});

describe('demo', () => {
  test('demo sign-in lands in the demo workspace; demo cannot change credentials', async () => {
    const c = new Client(t.http, '10.7.0.1');
    const r = await c.demo('demo_admin');
    assert.equal(r.data.workspace, 'demo');
    assert.equal(r.data.user.isDemo, true);
    assert.equal(r.data.user.role, 'admin');
    assert.equal((await c.post('/me/password', { currentPassword: 'x', newPassword: 'y' })).data.error.code, 'demo_forbidden');
    assert.equal((await c.get('/me/passkeys')).status, 403);
    assert.equal((await c.post('/me/passkeys/options', {})).status, 403);
    const me = (await c.get('/me')).data;
    assert.equal((await c.patch('/me', { name: 'Hacker' }, me.version)).status, 403);
    assert.equal((await c.patch('/me', { theme: 'dark' }, me.version)).status, 200);
  });

  test('demo accounts have no usable password', async () => {
    const r = await new Client(t.http, '10.7.0.2').post('/auth/login', { username: 'demo', password: '' });
    assert.equal(r.status, 400);
    const r2 = await new Client(t.http, '10.7.0.2').post('/auth/login', { username: 'demo', password: 'demo123' });
    assert.equal(r2.status, 401);
  });

  test('30 demo sign-ins per hour per IP', async () => {
    const c = new Client(t.http, '10.7.1.1');
    for (let i = 0; i < 30; i++) assert.equal((await c.post('/auth/demo', { account: 'demo' })).status, 200);
    assert.equal((await c.post('/auth/demo', { account: 'demo' })).status, 429);
  });
});

describe('test-only endpoints', () => {
  test('require the TEST_RESET_TOKEN header', async () => {
    const c = new Client(t.http);
    assert.equal((await c.get('/test/outbox')).status, 403);
    assert.equal((await c.get('/test/outbox', { headers: { 'test-reset-token': 'wrong' } })).status, 403);
    assert.equal((await c.get('/test/outbox', { headers: { 'test-reset-token': TEST_TOKEN } })).status, 200);
  });
});
