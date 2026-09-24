// Temporal first: shared/rules use the global Temporal (Node 24 has none yet).
import 'temporal-polyfill/global';
import './warnings.js';
import fs from 'node:fs';
import http2 from 'node:http2';
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
if (config.testNow) {
  // Deterministic calendar time for visual tests (NODE_ENV=test only).
  const { clock } = await import('../shared/rules/time.js');
  const offset = config.testNow - Date.now();
  clock.now = () => Date.now() + offset;
}
const app = await createApp(config, log);
const http = createHttpApp(app);
benchmarkHashing(log).catch(() => {});
const jobs = startJobs(app, {
  mediaCleanup: () => {
    cleanupMedia(app, app.workspaces.main);
    cleanupMedia(app, app.workspaces.demo);
  },
  backup: async () => {
    await runNightlyBackup(app);
  },
});

// HTTPS with HTTP/2 when TLS files are configured (no reverse proxy); plain HTTP otherwise.
const tls = config.tls
  ? {
      createServer: http2.createSecureServer,
      serverOptions: { cert: fs.readFileSync(config.tls.cert), key: fs.readFileSync(config.tls.key), allowHTTP1: true },
    }
  : {};
const server = serve({ fetch: http.fetch, port: config.port, .../** @type {any} */ (tls) }, (info) => {
  log.info({ port: info.port, url: config.appUrl, assets: config.assets, tls: !!config.tls }, 'Casa Artis Calendar is running');
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
