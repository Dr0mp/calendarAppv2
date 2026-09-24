import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

/**
 * @typedef {DatabaseSync & { tx: <T>(fn: () => T) => T, file: string }} Db
 */

/** @param {DatabaseSync} db */
function applyPragmas(db) {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
}

/**
 * Run the numbered migrations of `kind` ('auth' | 'workspace') that are newer
 * than `PRAGMA user_version`, all inside one transaction.
 * @param {DatabaseSync} db
 * @param {'auth'|'workspace'} kind
 */
export function migrate(db, kind) {
  const dir = path.join(MIGRATIONS_DIR, kind);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  const current = /** @type {{user_version:number}} */ (db.prepare('PRAGMA user_version').get()).user_version;
  const pending = files.filter((f) => Number(f.slice(0, 3)) > current);
  if (!pending.length) return current;
  db.exec('BEGIN IMMEDIATE');
  try {
    let version = current;
    for (const f of pending) {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      version = Number(f.slice(0, 3));
    }
    db.exec(`PRAGMA user_version = ${version}`);
    db.exec('COMMIT');
    return version;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Add a re-entrant `tx()` helper: the outermost call runs BEGIN IMMEDIATE /
 * COMMIT, nested calls use savepoints. Callbacks must be synchronous.
 * @param {DatabaseSync} raw
 * @param {string} file
 * @returns {Db}
 */
function withTx(raw, file) {
  const db = /** @type {Db} */ (raw);
  let depth = 0;
  db.file = file;
  db.tx = (fn) => {
    const sp = `sp${depth}`;
    db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    depth++;
    try {
      const out = fn();
      if (out && typeof (/** @type {any} */ (out).then) === 'function') {
        throw new Error('db.tx callback must be synchronous');
      }
      depth--;
      db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return out;
    } catch (err) {
      depth--;
      db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    }
  };
  return db;
}

/** @param {string} dataDir */
export function openAuth(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'auth.db');
  const db = new DatabaseSync(file);
  applyPragmas(db);
  migrate(db, 'auth');
  return withTx(db, file);
}

/**
 * Open a workspace database and attach auth.db, so one transaction can span both.
 * @param {string} dataDir
 * @param {'main'|'demo'} name
 */
export function openWorkspace(dataDir, name) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, `${name}.db`);
  const db = new DatabaseSync(file);
  applyPragmas(db);
  migrate(db, 'workspace');
  db.prepare('ATTACH DATABASE ? AS auth').run(path.join(dataDir, 'auth.db'));
  return withTx(db, file);
}

/** Bytes used by a database file plus its WAL. @param {string} file */
export function dbFileSize(file) {
  let total = 0;
  for (const f of [file, `${file}-wal`]) {
    try {
      total += fs.statSync(f).size;
    } catch {
      /* missing is fine */
    }
  }
  return total;
}
