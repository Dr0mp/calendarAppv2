import { Hono } from 'hono';
import { body, requireUser } from '../app.js';
import { ApiError, forbidden, notFound, tooMany } from '../errors.js';
import { DemoLogin, Forgot, Login, SetPassword } from '../../../shared/schemas/auth.js';
import { hit, loginAllowed, loginFailed, loginSucceeded } from '../../auth/ratelimit.js';
import { checkPassword, hashPassword, verifyPassword } from '../../auth/passwords.js';
import { authenticationOptions, verifyAuthentication } from '../../auth/passkeys.js';
import { consumeToken, createToken, peekToken } from '../../auth/tokens.js';
import { revokeUserSessions, deleteSession } from '../../auth/sessions.js';
import { composeMail } from '../../auth/email.js';
import { findByLogin, loadUser, setPasswordHash } from '../../services/users.js';
import { clearCookie, sessionPayload, signIn } from '../session.js';
import { isoNow, HOUR } from '../../util.js';
import { z } from 'zod';

/** @type {Hono<import('../app.js').Env>} */
export const authRoutes = new Hono();

authRoutes.get('/session', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(sessionPayload(c));
});

const invalidCredentials = () => new ApiError(401, 'invalid_credentials', 'Wrong username or password');

authRoutes.post('/auth/login', async (c) => {
  const app = c.get('app');
  const { username, password } = await body(c, Login);
  const ip = c.get('ip');
  const gate = loginAllowed(app.authDb, username, ip);
  if (!gate.ok) throw tooMany(gate.retryAfter);
  const user = findByLogin(app.authDb, username);
  const usable = user && !user.is_demo && !user.is_seed && user.status === 'active' ? user : null;
  const { ok, rehash } = await verifyPassword(usable?.password_hash ?? null, password);
  if (!ok || !usable) {
    loginFailed(app.authDb, username, ip);
    throw invalidCredentials();
  }
  loginSucceeded(app.authDb, username, ip);
  if (rehash) setPasswordHash(app.authDb, usable.id, await hashPassword(password));
  app.authDb.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(isoNow(), usable.id);
  signIn(c, loadUser(app.authDb, usable.id), 'main');
  return c.json(sessionPayload(c));
});

authRoutes.post('/auth/demo', async (c) => {
  const app = c.get('app');
  if (!app.config.demoEnabled) throw notFound('demo_disabled');
  const { account } = await body(c, DemoLogin);
  const r = hit(app.authDb, `demo:${c.get('ip')}`, 30, HOUR);
  if (!r.ok) throw tooMany(r.retryAfter);
  const user = /** @type {any} */ (app.authDb.prepare('SELECT * FROM users WHERE username = ? AND is_demo = 1').get(account));
  if (!user || user.status !== 'active') throw notFound('demo_disabled');
  signIn(c, user, 'demo');
  return c.json(sessionPayload(c));
});

authRoutes.post('/auth/logout', (c) => {
  const app = c.get('app');
  const s = c.get('session');
  if (s) deleteSession(app.authDb, s.id_hash);
  clearCookie(c);
  return c.json({ ok: true });
});

authRoutes.post('/auth/logout-all', (c) => {
  const app = c.get('app');
  const user = requireUser(c);
  revokeUserSessions(app.authDb, user.id);
  clearCookie(c);
  return c.json({ ok: true });
});

authRoutes.post('/auth/passkey/options', async (c) => {
  const app = c.get('app');
  const gate = loginAllowed(app.authDb, 'passkey', c.get('ip'));
  if (!gate.ok) throw tooMany(gate.retryAfter);
  return c.json(await authenticationOptions(app.authDb, app.config));
});

authRoutes.post('/auth/passkey/verify', async (c) => {
  const app = c.get('app');
  const ip = c.get('ip');
  const gate = loginAllowed(app.authDb, 'passkey', ip);
  if (!gate.ok) throw tooMany(gate.retryAfter);
  const { response } = await body(c, z.strictObject({ response: z.record(z.string(), z.unknown()) }));
  const result = await verifyAuthentication(app.authDb, app.config, response);
  const user = result && loadUser(app.authDb, result.userId);
  if (!user || user.status !== 'active' || user.is_demo) {
    loginFailed(app.authDb, 'passkey', ip);
    throw new ApiError(401, 'passkey_failed', 'Passkey sign-in failed');
  }
  app.authDb.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(isoNow(), user.id);
  signIn(c, user, 'main');
  return c.json(sessionPayload(c));
});

authRoutes.post('/auth/forgot', async (c) => {
  const app = c.get('app');
  const { login } = await body(c, Forgot);
  const ipGate = hit(app.authDb, `forgot-ip:${c.get('ip')}`, 5, HOUR);
  if (!ipGate.ok) throw tooMany(ipGate.retryAfter);
  const user = findByLogin(app.authDb, login);
  if (user && user.status === 'active' && !user.is_demo && !user.is_seed && user.email) {
    const acct = hit(app.authDb, `forgot-user:${user.id}`, 3, HOUR);
    if (acct.ok && app.mailer.configured) {
      const token = createToken(app.authDb, user.id, 'reset');
      const mail = composeMail('reset', user.locale, user.name, `${app.config.appUrl}/reset/${token}`);
      app.mailer.send({ to: user.email, ...mail }).catch((err) => app.log.error({ err }, 'reset email failed'));
    }
  }
  // Always the same answer, whether or not the account exists.
  return c.json({ ok: true }, 202);
});

authRoutes.get('/auth/token/:token', (c) => {
  const app = c.get('app');
  const t = peekToken(app.authDb, c.req.param('token'));
  const user = t && loadUser(app.authDb, t.userId);
  if (!t || !user || user.status === 'disabled') throw notFound('token_invalid');
  return c.json({ purpose: t.purpose, user: { name: user.name, username: user.username } });
});

authRoutes.post('/auth/token/:token', async (c) => {
  const app = c.get('app');
  const raw = c.req.param('token');
  const { password } = await body(c, SetPassword);
  const t = peekToken(app.authDb, raw);
  const user = t && loadUser(app.authDb, t.userId);
  if (!t || !user || user.status === 'disabled') throw notFound('token_invalid');
  if (user.is_demo || user.is_seed) throw forbidden('demo_forbidden');
  const policy = await checkPassword(password, user, { hibp: app.config.hibpCheck });
  if (policy) throw new ApiError(400, policy, 'Password rejected', { fields: { password: policy } });
  const hash = await hashPassword(password);
  const consumed = app.authDb.tx(() => {
    const ok = consumeToken(app.authDb, raw);
    if (!ok) return null;
    setPasswordHash(app.authDb, user.id, hash);
    revokeUserSessions(app.authDb, user.id);
    return ok;
  });
  if (!consumed) throw notFound('token_invalid');
  app.authDb.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(isoNow(), user.id);
  signIn(c, loadUser(app.authDb, user.id), 'main');
  return c.json(sessionPayload(c));
});
