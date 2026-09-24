import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client } from './harness.js';

/** @type {Awaited<ReturnType<typeof startApp>>} */
let t;
before(async () => {
  t = await startApp({ ENABLE_DEMO_ACCOUNTS: '0' });
});
after(() => t.close());

test('demo disabled: no chips, no sign-in', async () => {
  const c = new Client(t.http);
  assert.equal((await c.get('/session')).data.features.demo, false);
  const r = await c.post('/auth/demo', { account: 'demo' });
  assert.equal(r.status, 404);
  assert.equal(r.data.error.code, 'demo_disabled');
});

test('existing demo sessions stop working', async () => {
  const { createSession } = await import('../../server/auth/sessions.js');
  const demo = /** @type {any} */ (t.app.authDb.prepare("SELECT id FROM users WHERE username = 'demo'").get());
  const { value } = createSession(t.app.authDb, { userId: demo.id, workspace: 'demo' }, t.app.config);
  const c = new Client(t.http);
  c.cookies.set('sid', value);
  assert.equal((await c.get('/session')).data.user, null);
});

test('no test endpoints without NODE_ENV=test', async () => {
  const { loadConfig } = await import('../../server/config.js');
  assert.throws(() => loadConfig({ APP_URL: 'not a url' }), /APP_URL/);
  assert.equal(loadConfig({ APP_URL: 'https://x.example' }).isTest, false);
});
