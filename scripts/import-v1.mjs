#!/usr/bin/env node
// Import v1 data into a fresh v2 install (§14).
//
//   npm run import-v1 -- --users <users.json> --workspace <data/workspace.json> --uploads <data/uploads> [--dry-run]
//
// Uses the same environment as the server (DATA_DIR, APP_URL, …). Run it
// once, before the first real use, with the server stopped.
import 'temporal-polyfill/global';
import '../server/warnings.js';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import pino from 'pino';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { importV1, formatReport } from '../server/import/v1.js';

const { values } = parseArgs({
  options: {
    users: { type: 'string' },
    workspace: { type: 'string' },
    uploads: { type: 'string' },
    'uploads-prefix': { type: 'string', default: '/uploads' },
    'dry-run': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || !values.users || !values.workspace) {
  console.log('Usage: npm run import-v1 -- --users <users.json> --workspace <workspace.json> [--uploads <folder>] [--dry-run] [--json]');
  process.exit(values.help ? 0 : 1);
}

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Cannot read ${file}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

const users = readJson(values.users);
const workspace = readJson(values.workspace);
if (!Array.isArray(users)) {
  console.error('users.json must be an array of users.');
  process.exit(1);
}
if (values.uploads && !fs.existsSync(values.uploads)) {
  console.error(`Uploads folder not found: ${values.uploads}`);
  process.exit(1);
}

// A fresh install gets no sample content; the import provides the real data.
process.env.SEED_SAMPLE_CONTENT = '0';
process.env.APP_URL ??= 'http://localhost:3000';
let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const app = await createApp(config, pino({ level: 'warn' }));
try {
  const report = await importV1(app, { users, workspace, uploadsDir: values.uploads ?? null, uploadsPrefix: values['uploads-prefix'], dryRun: values['dry-run'] });
  console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
} catch (err) {
  console.error(`Import failed, nothing was changed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  app.close();
}
