import { createToken } from '../auth/tokens.js';
import { findByLogin, insertUser } from './users.js';
import sample from '../seed/sample-content.json' with { type: 'json' };

/**
 * First-run accounts: the root admin (no password; a one-time setup link is
 * printed), the two demo accounts and the fictitious seed users.
 * @param {import('../app.js').App} app
 */
export async function bootstrapAccounts(app) {
  const { authDb: db, config } = app;
  /** @type {string|null} */ let setupLink = null;
  db.tx(() => {
    let root = /** @type {any} */ (db.prepare('SELECT * FROM users WHERE is_root = 1').get());
    if (!root) {
      if (findByLogin(db, config.bootstrapUsername)) {
        throw new Error(`ADMIN_BOOTSTRAP_USERNAME "${config.bootstrapUsername}" is already taken by another account`);
      }
      root = insertUser(db, {
        username: config.bootstrapUsername,
        name: 'Administrator',
        email: config.bootstrapEmail || null,
        role: 'admin',
        isRoot: true,
        status: 'invited',
        color: 'owner-7',
      });
    }
    // Until the owner sets a password, every start prints a fresh setup link.
    if (!root.password_hash && root.status === 'invited') {
      setupLink = `${config.appUrl}/invite/${createToken(db, root.id, 'invite')}`;
    }

    const demo = [
      { username: 'demo', name: 'Demo Utilizator', role: 'user', color: 'owner-4' },
      { username: 'demo_admin', name: 'Demo Administrator', role: 'admin', color: 'owner-11' },
    ];
    for (const d of demo) {
      const existing = findByLogin(db, d.username);
      if (!existing) insertUser(db, { ...d, isDemo: true, status: 'active' });
      else if (!existing.is_demo) app.log.warn({ username: d.username }, 'a real account uses a demo username; demo sign-in disabled for it');
    }
    restoreSeedUsers(db);
    if (!config.demoEnabled) db.prepare("DELETE FROM sessions WHERE workspace = 'demo'").run();
  });
  return { setupLink };
}

/**
 * The demo's fictitious people: remove any the demo admin added, and put the
 * sample ones (Anca, Alex, Ioana) back as they were. Runs at start and on
 * every demo reset.
 * @param {import('../db/open.js').Db} db auth database
 */
export function restoreSeedUsers(db) {
  db.tx(() => {
    const keep = sample.seedUsers.map((s) => s.username);
    const extra = /** @type {any[]} */ (db.prepare('SELECT id, username FROM users WHERE is_seed = 1').all()).filter((u) => !keep.includes(u.username));
    for (const u of extra) db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    for (const s of sample.seedUsers) {
      const cur = findByLogin(db, s.username);
      if (!cur) insertUser(db, { username: s.username, name: s.name, role: s.role, color: s.color, isSeed: true, status: 'active' });
      else if (cur.is_seed) {
        db.prepare(
          `UPDATE users SET name = ?, role = ?, color = ?, status = 'active', initials = NULL, email = NULL, version = version + 1
           WHERE id = ? AND (name <> ? OR role <> ? OR color <> ? OR status <> 'active' OR initials IS NOT NULL OR email IS NOT NULL)`,
        ).run(s.name, s.role, s.color, cur.id, s.name, s.role, s.color);
      }
    }
  });
}
