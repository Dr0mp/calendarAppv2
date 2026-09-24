import { Hono } from 'hono';
import { body, requireAdmin, requireNotDemo, wsOf } from '../app.js';
import { ApiError, forbidden } from '../errors.js';
import { SettingsPatch } from '../../../shared/schemas/settings.js';
import { allSettings, DEFAULTS, setSetting } from '../../services/settings.js';
import * as timeRules from '../../../shared/rules/time.js';
import { isValidTimeZone, localToUtc } from '../../../shared/rules/time.js';
import { composeMail } from '../../auth/email.js';
import { storageStatus } from '../../services/storage.js';

/** @type {Hono<import('../app.js').Env>} */
export const settingsRoutes = new Hono();

/** @param {any} c */
function view(c) {
  const app = c.get('app');
  const ws = wsOf(c);
  const s = allSettings(ws.db);
  return {
    org_name: s.org_name,
    tz: s.tz,
    default_locale: s.default_locale,
    promo_template: s.promo_template,
    default_promo_template: DEFAULTS.promo_template,
    storage_cap_bytes: ws.capBytes(),
    storage_cap_max_bytes: ws.name === 'demo' ? app.config.demoStorageCapBytes : app.config.storageCapBytes,
    storage: storageStatus(app, ws),
    email: { configured: app.mailer.configured, from: app.config.mailFrom || null },
    demo: { enabled: app.config.demoEnabled, resetHour: app.config.demoResetHour },
    workspace: ws.name,
  };
}

settingsRoutes.get('/settings', (c) => {
  requireAdmin(c);
  return c.json(view(c));
});

settingsRoutes.patch('/settings', async (c) => {
  requireAdmin(c);
  const u = c.get('user');
  if (u.is_demo) throw forbidden('demo_forbidden');
  const app = c.get('app');
  const ws = wsOf(c);
  const patch = await body(c, SettingsPatch);
  if (patch.tz !== undefined && !isValidTimeZone(patch.tz)) {
    throw new ApiError(400, 'validation_error', 'Invalid time zone', { fields: { tz: 'invalid_timezone' } });
  }
  if (patch.storage_cap_bytes !== undefined && patch.storage_cap_bytes > app.config.storageCapBytes) {
    throw new ApiError(400, 'validation_error', 'Cap above the environment maximum', { fields: { storage_cap_bytes: 'too_big' } });
  }
  ws.db.tx(() => {
    for (const [k, v] of Object.entries(patch)) setSetting(ws.db, /** @type {any} */ (k), String(v));
    // Session instants depend on the zone: recompute them.
    if (patch.tz) {
      const rows = /** @type {any[]} */ (ws.db.prepare('SELECT id, date, start_time, end_time FROM entry_sessions').all());
      const stmt = ws.db.prepare('UPDATE entry_sessions SET start_utc = ?, end_utc = ? WHERE id = ?');
      for (const r of rows) stmt.run(localToUtc(r.date, r.start_time, patch.tz), localToUtc(r.date, r.end_time, patch.tz), r.id);
    }
  });
  return c.json(view(c));
});

settingsRoutes.post('/settings/test-email', async (c) => {
  const u = requireAdmin(c);
  requireNotDemo(c);
  const app = c.get('app');
  if (!app.mailer.configured) throw new ApiError(400, 'email_not_configured');
  if (!u.email) throw new ApiError(400, 'no_email_address');
  const mail = composeMail('test', u.locale, u.name);
  try {
    await app.mailer.send({ to: u.email, ...mail });
  } catch (err) {
    app.log.error({ err }, 'test email failed');
    throw new ApiError(502, 'email_failed');
  }
  return c.json({ ok: true, to: u.email });
});

settingsRoutes.post('/settings/demo-reset', (c) => {
  requireAdmin(c);
  const app = c.get('app');
  if (!app.config.demoEnabled) throw new ApiError(400, 'demo_disabled');
  app.resetDemo();
  return c.json({ ok: true });
});

settingsRoutes.get('/admin/summary', (c) => {
  requireAdmin(c);
  const app = c.get('app');
  const ws = wsOf(c);
  const { todayIn, addDays } = /** @type {any} */ (timeRules);
  const today = todayIn(ws.tz());
  const weekEnd = addDays(today, 6);
  const vis = ws.name === 'demo' ? '(is_demo = 1 OR is_seed = 1)' : '(is_demo = 0 AND is_seed = 0)';
  const activeUsers = /** @type {any} */ (app.authDb.prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND ${vis}`).get()).n;
  const upcomingWeek = /** @type {any} */ (
    ws.db.prepare('SELECT COUNT(DISTINCT e.id) AS n FROM entries e WHERE e.last_date >= ? AND e.first_date <= ?').get(today, weekEnd)
  ).n;
  const pendingPromotions = /** @type {any} */ (
    ws.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE type = 'event' AND promotion_status = 'pending' AND last_date >= ?").get(today)
  ).n;
  return c.json({ activeUsers, upcomingWeek, pendingPromotions, storage: storageStatus(app, ws) });
});
