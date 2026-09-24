import { Hono } from 'hono';
import { forbidden } from '../errors.js';
import { safeEqual } from '../../auth/crypto.js';
import { hashPassword } from '../../auth/passwords.js';
import { createToken } from '../../auth/tokens.js';
import { findByLogin, insertUser } from '../../services/users.js';

/**
 * Test-only endpoints. Mounted only when NODE_ENV=test, and every call must
 * carry the TEST_RESET_TOKEN header.
 * @type {Hono<import('../app.js').Env>}
 */
export const testRoutes = new Hono();

testRoutes.use('/test/*', async (c, next) => {
  const app = c.get('app');
  const token = c.req.header('test-reset-token') ?? '';
  if (!app.config.testResetToken || !safeEqual(token, app.config.testResetToken)) throw forbidden();
  return next();
});

testRoutes.get('/test/outbox', (c) => c.json({ items: c.get('app').mailer.outbox ?? [] }));

testRoutes.post('/test/reset-demo', async (c) => {
  await c.get('app').resetDemo();
  // Tests sign in to the demo many times from one IP; start each from a clean slate.
  c.get('app').authDb.prepare("DELETE FROM rate_limits WHERE key LIKE 'demo:%' OR key LIKE 'upload-ip:%'").run();
  return c.json({ ok: true });
});

testRoutes.get('/test/setup-link', (c) => c.json({ link: c.get('app').setupLink ?? null }));

/** Create (or reset) an active user with a password. */
testRoutes.post('/test/user', async (c) => {
  const app = c.get('app');
  const { username, role = 'user', password, email = null, name } = await c.req.json();
  const existing = findByLogin(app.authDb, username);
  const hash = await hashPassword(password);
  if (existing) {
    app.authDb.prepare("UPDATE users SET password_hash = ?, status = 'active', role = ? WHERE id = ?").run(hash, role, existing.id);
    return c.json({ id: existing.id });
  }
  const u = insertUser(app.authDb, { username, role, name: name ?? username, email, status: 'active', passwordHash: hash });
  return c.json({ id: u.id });
});

/** Create an invited user and return the invitation link. */
testRoutes.post('/test/invite', async (c) => {
  const app = c.get('app');
  const { username, role = 'user', name } = await c.req.json();
  const u = insertUser(app.authDb, { username, role, name: name ?? username, status: 'invited' });
  return c.json({ link: `${app.config.appUrl}/invite/${createToken(app.authDb, u.id, 'invite')}` });
});
