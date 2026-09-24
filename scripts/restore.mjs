#!/usr/bin/env node
// Restore a backup made by "Descarcă backup" or the nightly job.
//
//   npm run restore -- <backup.zip>
//
// Stop the server first. The current databases and media are moved to
// DATA_DIR/pre-restore-<time>/; all sessions, tokens and passkey
// challenges are purged, so everyone signs in again.
import fs from 'node:fs';
import path from 'node:path';
import { restoreBackup } from '../server/services/backup.js';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: npm run restore -- <backup.zip>   (with the server stopped; DATA_DIR as for the server)');
  process.exit(1);
}
const dataDir = path.resolve(process.env.DATA_DIR || './data');
try {
  const r = restoreBackup(dataDir, fs.readFileSync(file));
  console.log(`Restored ${r.restoredFiles} files into ${dataDir}.`);
  console.log(`The previous data is in ${r.previous} (delete it once you have checked the restore).`);
  console.log('All sessions were signed out. Start the server again.');
} catch (err) {
  console.error(`Restore failed, nothing was changed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}
