import fs from 'node:fs';
import path from 'node:path';
import { openAuth, openWorkspace } from './db/open.js';
import { createMailer } from './auth/email.js';
import { getSetting } from './services/settings.js';
import { bootstrapAccounts } from './services/bootstrap.js';
import { seedWorkspace } from './seed/seed.js';

/**
 * @typedef {{
 *   name: 'main'|'demo',
 *   db: import('./db/open.js').Db,
 *   mediaDir: string,
 *   tz: () => string,
 *   capBytes: () => number,
 * }} Workspace
 * @typedef {{
 *   config: import('./config.js').Config,
 *   log: import('pino').Logger,
 *   authDb: import('./db/open.js').Db,
 *   workspaces: {main: Workspace, demo: Workspace},
 *   mailer: import('./auth/email.js').Mailer,
 *   shell?: {html: string, scriptHash: string, cdnHost: string},
 *   setupLink?: string|null,
 *   resetDemo: () => void,
 *   close: () => void,
 * }} App
 */

/**
 * @param {import('./config.js').Config} config
 * @param {'main'|'demo'} name
 * @returns {Workspace}
 */
function makeWorkspace(config, name) {
  const mediaDir = path.join(config.dataDir, 'media', name);
  fs.mkdirSync(mediaDir, { recursive: true });
  const ws = {
    name,
    db: openWorkspace(config.dataDir, name),
    mediaDir,
    tz: () => getSetting(ws.db, 'tz'),
    capBytes: () => {
      if (name === 'demo') return config.demoStorageCapBytes;
      const v = Number(getSetting(ws.db, 'storage_cap_bytes'));
      return v > 0 ? Math.min(v, config.storageCapBytes) : config.storageCapBytes;
    },
  };
  return /** @type {Workspace} */ (ws);
}

/**
 * Open databases, bootstrap accounts and seed content.
 * @param {import('./config.js').Config} config
 * @param {import('pino').Logger} log
 * @returns {Promise<App>}
 */
export async function createApp(config, log) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const authDb = openAuth(config.dataDir);
  const main = makeWorkspace(config, 'main');
  // The demo workspace is rebuilt from the seed on every start.
  removeWorkspaceFiles(config, 'demo');
  const demo = makeWorkspace(config, 'demo');

  /** @type {App} */
  const app = {
    config,
    log,
    authDb,
    workspaces: { main, demo },
    mailer: createMailer(config, log),
    resetDemo() {
      app.workspaces.demo.db.close();
      removeWorkspaceFiles(config, 'demo');
      app.workspaces.demo = makeWorkspace(config, 'demo');
      seedWorkspace(app, app.workspaces.demo);
      log.info('demo workspace reset');
    },
    close() {
      app.workspaces.main.db.close();
      app.workspaces.demo.db.close();
      authDb.close();
    },
  };

  const { setupLink } = await bootstrapAccounts(app);
  app.setupLink = setupLink;
  if (setupLink) {
    const line = '─'.repeat(72);
    // Printed on purpose (not only logged) so the owner sees it on first run.
    console.log(`\n${line}\n  Casa Artis — first-run setup\n  Open this link to set the root admin's password:\n\n  ${setupLink}\n${line}\n`);
  }
  seedWorkspace(app, main);
  seedWorkspace(app, app.workspaces.demo);
  return app;
}

/** @param {import('./config.js').Config} config @param {'main'|'demo'} name */
function removeWorkspaceFiles(config, name) {
  for (const f of [`${name}.db`, `${name}.db-wal`, `${name}.db-shm`]) {
    fs.rmSync(path.join(config.dataDir, f), { force: true });
  }
  fs.rmSync(path.join(config.dataDir, 'media', name), { recursive: true, force: true });
}
