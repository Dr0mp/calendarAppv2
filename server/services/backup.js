// Backups (§7.6): a zip with consistent snapshots of auth.db and main.db,
// taken together, plus the main media folder. The demo is never backed up.
import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import { newId } from '../util.js';

/** @typedef {import('../app.js').App} App */

export const KEEP_DAYS = 7;

/**
 * Snapshot both databases with VACUUM INTO. node:sqlite is synchronous and
 * the server is one process, so no write can land between the two.
 * @param {App} app @param {string} dir
 */
export function snapshot(app, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ws = app.workspaces.main;
  const auth = path.join(dir, 'auth.db');
  const main = path.join(dir, 'main.db');
  for (const f of [auth, main]) fs.rmSync(f, { force: true });
  const q = (/** @type {string} */ p) => `'${p.replaceAll("'", "''")}'`;
  ws.db.exec(`VACUUM auth INTO ${q(auth)}`);
  ws.db.exec(`VACUUM main INTO ${q(main)}`);
  return { auth, main };
}

/** Every file under a folder (relative paths), skipping temporary uploads. @param {string} root */
function walk(root) {
  /** @type {string[]} */ const out = [];
  if (!fs.existsSync(root)) return out;
  const go = (/** @type {string} */ rel) => {
    for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (r !== 'tmp') go(r);
      } else if (d.isFile()) out.push(r);
    }
  };
  go('');
  return out;
}

/**
 * Build the backup zip as a stream. The snapshots are written to a
 * temporary folder that is removed once the stream ends.
 * @param {App} app
 * @returns {{stream: NodeJS.ReadableStream, filename: string, done: Promise<void>}}
 */
export function backupZip(app) {
  const tmp = path.join(app.config.dataDir, 'tmp', `backup-${newId()}`);
  const { auth, main } = snapshot(app, tmp);
  const zip = new yazl.ZipFile();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  zip.addFile(auth, 'auth.db');
  zip.addFile(main, 'main.db');
  zip.addBuffer(
    Buffer.from(JSON.stringify({ app: 'calendar-v2', createdAt: new Date().toISOString(), contents: ['auth.db', 'main.db', 'media/'] }, null, 2)),
    'backup.json',
  );
  const mediaDir = app.workspaces.main.mediaDir;
  for (const rel of walk(mediaDir)) zip.addFile(path.join(mediaDir, rel), `media/${rel}`, { compress: false });
  zip.end();
  const done = new Promise((resolve) => {
    const finish = () => resolve(undefined);
    zip.outputStream.on('end', finish);
    zip.outputStream.on('error', finish);
    zip.outputStream.on('close', finish);
  }).then(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return { stream: zip.outputStream, filename: `backup-${stamp}.zip`, done };
}

/**
 * Write a backup into BACKUP_DIR and keep the last 7 days.
 * @param {App} app
 */
export async function runNightlyBackup(app) {
  const dir = app.config.backupDir;
  fs.mkdirSync(dir, { recursive: true });
  const { stream, filename, done } = backupZip(app);
  const target = path.join(dir, filename);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(`${target}.part`);
    out.on('finish', () => resolve(undefined));
    out.on('error', reject);
    stream.on('error', reject);
    stream.pipe(out);
  });
  await done;
  fs.renameSync(`${target}.part`, target);
  pruneBackups(dir);
  app.log.info({ file: target }, 'backup written');
  return target;
}

/** Remove backups older than KEEP_DAYS. @param {string} dir @param {number} [now] */
export function pruneBackups(dir, now = Date.now()) {
  const limit = now - KEEP_DAYS * 24 * 3600 * 1000;
  for (const f of fs.readdirSync(dir)) {
    if (!/^backup-.*\.zip$/.test(f)) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs < limit) fs.rmSync(p, { force: true });
  }
}
