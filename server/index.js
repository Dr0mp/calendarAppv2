// Temporal first: shared/rules use the global Temporal (Node 24 has none yet).
import 'temporal-polyfill/global';
import './warnings.js';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import { createApp } from './app.js';
import { createHttpApp } from './http/app.js';
import { startJobs } from './jobs/scheduler.js';
import { benchmarkHashing } from './auth/passwords.js';
import { cleanupMedia } from './services/media.js';
import { runNightlyBackup } from './services/backup.js';


let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const log = createLogger(config);
const app = await createApp(config, log);
const http = createHttpApp(app);
benchmarkHashing(log).catch(() => {});
const jobs = startJobs(app, {
  mediaCleanup: () => {
    cleanupMedia(app, app.workspaces.main);
    cleanupMedia(app, app.workspaces.demo);
  },
  backup: () => runNightlyBackup(app),
});

const server = serve({ fetch: http.fetch, port: config.port }, (info) => {
  log.info({ port: info.port, url: config.appUrl, assets: config.assets }, 'Casa Artis Calendar is running');
});

function shutdown() {
  jobs.stop();
  server.close(() => {
    app.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
