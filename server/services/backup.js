// Backups (§7.6): a zip with consistent snapshots of auth.db and main.db,
// taken together, plus the main media folder. The demo is never backed up.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import yazl from "yazl";
import { newId } from "../util.js";

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
  const auth = path.join(dir, "auth.db");
  const main = path.join(dir, "main.db");
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
    for (const d of fs.readdirSync(path.join(root, rel), {
      withFileTypes: true,
    })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (r !== "tmp") go(r);
      } else if (d.isFile()) out.push(r);
    }
  };
  go("");
  return out;
}

/**
 * Build the backup zip as a stream. The snapshots are written to a
 * temporary folder that is removed once the stream ends.
 * @param {App} app
 * @returns {{stream: NodeJS.ReadableStream, filename: string, done: Promise<void>}}
 */
export function backupZip(app) {
  const tmp = path.join(app.config.dataDir, "tmp", `backup-${newId()}`);
  const { auth, main } = snapshot(app, tmp);
  const zip = new yazl.ZipFile();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  zip.addFile(auth, "auth.db");
  zip.addFile(main, "main.db");
  zip.addBuffer(
    Buffer.from(
      JSON.stringify(
        {
          app: "calendar-v2",
          createdAt: new Date().toISOString(),
          contents: ["auth.db", "main.db", "media/"],
        },
        null,
        2,
      ),
    ),
    "backup.json",
  );
  const mediaDir = app.workspaces.main.mediaDir;
  for (const rel of walk(mediaDir))
    zip.addFile(path.join(mediaDir, rel), `media/${rel}`, { compress: false });
  zip.end();
  const done = new Promise((resolve) => {
    const finish = () => resolve(undefined);
    zip.outputStream.on("end", finish);
    zip.outputStream.on("error", finish);
    zip.outputStream.on("close", finish);
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
    out.on("finish", () => resolve(undefined));
    out.on("error", reject);
    stream.on("error", reject);
    stream.pipe(out);
  });
  await done;
  fs.renameSync(`${target}.part`, target);
  pruneBackups(dir);
  app.log.info({ file: target }, "backup written");
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

/**
 * Read the entries of a zip written by backupZip (stored or deflated, no
 * zip64). Returns name → Buffer.
 * @param {Buffer} buf
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file (no central directory).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  /** @type {Map<string, Buffer>} */ const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50)
      throw new Error("Corrupt zip central directory.");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start =
      local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (!name.endsWith("/"))
      out.set(
        name,
        method === 8
          ? zlib.inflateRawSync(raw)
          : method === 0
            ? Buffer.from(raw)
            : (() => {
                throw new Error(`Unsupported zip method ${method}`);
              })(),
      );
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * Restore a backup zip into DATA_DIR (the server must be stopped). The
 * current files are moved aside first; afterwards every session, token,
 * passkey challenge and rate limit is purged, so everyone signs in again.
 * @param {string} dataDir @param {Buffer} zip
 * @returns {{restoredFiles: number, previous: string}}
 */
export function restoreBackup(dataDir, zip) {
  const files = readZip(zip);
  if (!files.has("auth.db") || !files.has("main.db"))
    throw new Error(
      "This zip is not a Casa Artis backup (auth.db and main.db are missing).",
    );
  // Check both snapshots open before touching anything.
  const tmp = path.join(dataDir, `restore-check-${newId()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    for (const f of ["auth.db", "main.db"]) {
      fs.writeFileSync(path.join(tmp, f), /** @type {Buffer} */ (files.get(f)));
      const db = new DatabaseSync(path.join(tmp, f), { readOnly: true });
      db.prepare("SELECT COUNT(*) FROM sqlite_master").get();
      db.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const previous = path.join(
    dataDir,
    `pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  fs.mkdirSync(previous, { recursive: true });
  for (const f of [
    "auth.db",
    "auth.db-wal",
    "auth.db-shm",
    "main.db",
    "main.db-wal",
    "main.db-shm",
  ]) {
    if (fs.existsSync(path.join(dataDir, f)))
      fs.renameSync(path.join(dataDir, f), path.join(previous, f));
  }
  const media = path.join(dataDir, "media", "main");
  if (fs.existsSync(media))
    fs.renameSync(media, path.join(previous, "media-main"));
  let n = 0;
  for (const [name, data] of files) {
    if (name === "backup.json") continue;
    const target = name.startsWith("media/")
      ? path.join(media, name.slice("media/".length))
      : path.join(dataDir, name);
    if (!path.resolve(target).startsWith(path.resolve(dataDir) + path.sep))
      throw new Error(`Unsafe path in backup: ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    n++;
  }
  const auth = new DatabaseSync(path.join(dataDir, "auth.db"));
  auth.exec(
    "DELETE FROM sessions; DELETE FROM auth_tokens; DELETE FROM webauthn_challenges; DELETE FROM rate_limits;",
  );
  auth.close();
  return { restoredFiles: n, previous };
}
