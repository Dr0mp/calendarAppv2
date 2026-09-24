import { Hono } from 'hono';
import { body, ifMatch, requireNotDemo, requireUser, withVersion } from '../app.js';
import { ApiError, notFound } from '../errors.js';
import { ChangePassword, PasskeyName, PasskeyRegister } from '../../../shared/schemas/auth.js';
import { UpdateMe } from '../../../shared/schemas/user.js';
import { checkPassword, hashPassword, verifyPassword } from '../../auth/passwords.js';
import { listSessions, revokeUserSessions } from '../../auth/sessions.js';
import { registrationOptions, verifyRegistration } from '../../auth/passkeys.js';
import { loadUser, selfView, setPasswordHash, updateUser } from '../../services/users.js';
import { signIn } from '../session.js';

/** @type {Hono<import('../app.js').Env>} */
export const meRoutes = new Hono();

meRoutes.get('/me', (c) => withVersion(c, selfView(requireUser(c))));

meRoutes.patch('/me', async (c) => {
  const app = c.get('app');
  const user = requireUser(c);
  const patch = await body(c, UpdateMe);
  // Demo accounts may switch language and theme, but not change their profile.
  if (user.is_demo && (patch.name !== undefined || patch.email !== undefined)) throw new ApiError(403, 'demo_forbidden');
  const updated = updateUser(app.authDb, user, patch, ifMatch(c), user.id);
  return withVersion(c, selfView(updated));
});

meRoutes.post('/me/password', async (c) => {
  const app = c.get('app');
  const user = requireNotDemo(c);
  const { currentPassword, newPassword } = await body(c, ChangePassword);
  const { ok } = await verifyPassword(user.password_hash, currentPassword);
  if (!ok) throw new ApiError(400, 'wrong_current_password', 'Current password is wrong', { fields: { currentPassword: 'wrong_current_password' } });
  const policy = await checkPassword(newPassword, user, { hibp: app.config.hibpCheck });
  if (policy) throw new ApiError(400, policy, 'Password rejected', { fields: { newPassword: policy } });
  setPasswordHash(app.authDb, user.id, await hashPassword(newPassword));
  // A password change revokes every session; this device gets a fresh one.
  revokeUserSessions(app.authDb, user.id);
  c.set('session', null);
  signIn(c, loadUser(app.authDb, user.id), 'main');
  return c.json({ ok: true, csrfToken: c.get('session').csrf_token });
});

meRoutes.get('/me/sessions', (c) => {
  const app = c.get('app');
  const user = requireUser(c);
  const current = c.get('session');
  const items = listSessions(app.authDb, user.id).map((/** @type {any} */ s) => ({
    id: s.id,
    workspace: s.workspace,
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    userAgent: s.user_agent,
    ip: s.ip,
    current: s.id_hash === current.id_hash,
  }));
  return c.json({ items, nextCursor: null });
});

meRoutes.delete('/me/sessions/:id', (c) => {
  const app = c.get('app');
  const user = requireUser(c);
  const res = app.authDb.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(c.req.param('id'), user.id);
  if (!res.changes) throw notFound();
  return c.json({ ok: true });
});

const passkeyView = (/** @type {any} */ p) => ({ id: p.id, name: p.name, createdAt: p.created_at, lastUsedAt: p.last_used_at });

meRoutes.get('/me/passkeys', (c) => {
  const app = c.get('app');
  const user = requireNotDemo(c);
  const rows = app.authDb.prepare('SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at').all(user.id);
  return c.json({ items: rows.map(passkeyView), nextCursor: null });
});

meRoutes.post('/me/passkeys/options', async (c) => {
  const app = c.get('app');
  const user = requireNotDemo(c);
  return c.json(await registrationOptions(app.authDb, app.config, user));
});

meRoutes.post('/me/passkeys', async (c) => {
  const app = c.get('app');
  const user = requireNotDemo(c);
  const { name, response } = await body(c, PasskeyRegister);
  const ua = c.req.header('user-agent') ?? '';
  const fallback = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Passkey';
  const pk = await verifyRegistration(app.authDb, app.config, user.id, response, name || fallback);
  if (!pk) throw new ApiError(400, 'passkey_failed', 'Passkey registration failed');
  return c.json(passkeyView(pk), 201);
});

meRoutes.patch('/me/passkeys/:id', async (c) => {
  const app = c.get('app');
  const user = requireNotDemo(c);
  const { name } = await body(c, PasskeyName);
  const res = app.authDb.prepare('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?').run(name, c.req.param('id'), user.id);
  if (!res.changes) throw notFound();
  return c.json({ ok: true });
});

meRoutes.delete('/me/passkeys/:id', (c) => {
  const app = c.get('app');
  const user = requireNotDemo(c);
  const res = app.authDb.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(c.req.param('id'), user.id);
  if (!res.changes) throw notFound();
  return c.json({ ok: true });
});

meRoutes.get('/me/counts', (c) => {
  requireUser(c);
  return c.json({ myUpcoming: 0, promotions: 0 });
});
