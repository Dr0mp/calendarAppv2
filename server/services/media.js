// Media: streaming uploads, type detection from content, image processing
// (EXIF strip, WebP thumbnails, crop), video metadata and posters (ffmpeg,
// optional), content-addressed dedupe, the storage cap and cleanup.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { newId, isoNow, HOUR } from '../util.js';
import { ApiError } from '../http/errors.js';
import { storageStatus } from './storage.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);

/** Resolve the optional ffmpeg/ffprobe binaries once. */
const tools = (() => {
  /** @type {{ffmpeg: string|null, ffprobe: string|null}} */
  const t = { ffmpeg: null, ffprobe: null };
  try {
    const p = /** @type {string|null} */ (/** @type {unknown} */ (require('ffmpeg-static')));
    if (p && fs.existsSync(p)) t.ffmpeg = p;
  } catch {
    /* optional */
  }
  try {
    const p = require('ffprobe-static').path;
    if (p && fs.existsSync(p)) t.ffprobe = p;
  } catch {
    /* optional */
  }
  return t;
})();

export const videoToolsAvailable = () => !!(tools.ffmpeg && tools.ffprobe);

/**
 * Detect the file type from its first bytes (magic numbers). The file name
 * and declared type are ignored. SVG, HTML and everything else → null.
 * @param {Buffer} b
 * @returns {{mime: string, kind: 'image'|'video', ext: string}|null}
 */
export function detectType(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', kind: 'image', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', kind: 'image', ext: 'png' };
  const head = b.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return { mime: 'image/gif', kind: 'image', ext: 'gif' };
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', kind: 'image', ext: 'webp' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    // EBML: WebM declares its doctype early in the header.
    return b.subarray(0, 64).toString('latin1').includes('webm') ? { mime: 'video/webm', kind: 'video', ext: 'webm' } : null;
  }
  const box = b.subarray(4, 8).toString('latin1');
  if (box === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', kind: 'image', ext: 'avif' };
    if (brand === 'qt  ') return { mime: 'video/quicktime', kind: 'video', ext: 'mov' };
    if (/^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V |mmp4|f4v |MSNV|3gp)/.test(brand)) return { mime: 'video/mp4', kind: 'video', ext: 'mp4' };
    return null;
  }
  if (['moov', 'mdat', 'wide', 'free', 'skip'].includes(box)) return { mime: 'video/quicktime', kind: 'video', ext: 'mov' };
  return null;
}

/** @param {import('../app.js').Workspace} ws @param {string} rel */
const abs = (ws, rel) => path.join(ws.mediaDir, rel);

/** @param {string} id @param {string} ext @param {'originals'|'thumbs'} kind */
const relPath = (id, ext, kind) => path.join(kind, id.slice(-2), `${id}.${ext}`);

/** @param {string} p */
function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

/**
 * Stream a request body to a temporary file while hashing it; never buffers
 * the whole upload. Enforces the size limit as bytes arrive.
 * @param {ReadableStream<Uint8Array>|null} body @param {string} tmp @param {number} limit
 */
async function streamToFile(body, tmp, limit) {
  if (!body) throw new ApiError(400, 'empty_upload', 'No file');
  ensureDir(tmp);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(tmp);
  /** @type {Error|null} */ let writeErr = null;
  out.on('error', (e) => {
    writeErr = e;
  });
  let bytes = 0;
  /** @type {Buffer|null} */ let head = null;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new ApiError(413, 'too_large', 'File too large', { maxBytes: limit });
      const chunk = Buffer.from(value);
      if (!head || head.length < 64) head = Buffer.concat([head ?? Buffer.alloc(0), chunk]).subarray(0, 64);
      hash.update(chunk);
      if (writeErr) throw writeErr;
      if (!out.write(chunk)) await new Promise((r) => (out.once('drain', () => r(undefined)), out.once('error', () => r(undefined))));
    }
    if (writeErr) throw writeErr;
  } catch (err) {
    reader.cancel().catch(() => {});
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  await new Promise((resolve, reject) => out.end((/** @type {any} */ e) => (e ? reject(e) : resolve(undefined))));
  if (!bytes) {
    fs.rmSync(tmp, { force: true });
    throw new ApiError(400, 'empty_upload', 'Empty file');
  }
  return { bytes, sha256: hash.digest('hex'), head: /** @type {Buffer} */ (head) };
}

/** Refuse new media at or above the storage cap. @param {import('../app.js').App} app @param {import('../app.js').Workspace} ws @param {number} [adding] */
export function assertStorageRoom(app, ws, adding = 0) {
  const s = storageStatus(app, ws);
  if (s.used + adding > s.cap || s.used >= s.cap) throw new ApiError(507, 'storage_full', 'Storage is full', { used: s.used, cap: s.cap });
}

/**
 * Process a stored original: images get auto-orientation and EXIF removed
 * (re-encoded in their own format), plus a 480 px WebP thumbnail; videos get
 * metadata and a poster when ffmpeg is available.
 * @param {string} file @param {{mime: string, kind: string, ext: string}} type @param {string} thumbFile
 */
async function processFile(file, type, thumbFile) {
  /** @type {{width: number|null, height: number|null, duration_s: number|null, codec: string|null, thumbBytes: number, bytes: number}} */
  const info = { width: null, height: null, duration_s: null, codec: null, thumbBytes: 0, bytes: fs.statSync(file).size };
  if (type.kind === 'image') {
    let meta;
    try {
      meta = await sharp(file, { animated: type.mime === 'image/gif' }).metadata();
    } catch {
      throw new ApiError(415, 'unsupported_media', 'Unreadable image');
    }
    const rotated = (meta.orientation ?? 1) >= 5;
    info.width = rotated ? meta.height ?? null : meta.width ?? null;
    info.height = rotated ? meta.width ?? null : (meta.pageHeight ?? meta.height) ?? null;
    if (type.mime !== 'image/gif') {
      // Re-encode without metadata: removes EXIF (GPS) and applies the orientation.
      const tmp = `${file}.clean`;
      let pipeline = sharp(file).rotate();
      if (type.mime === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true });
      else if (type.mime === 'image/png') pipeline = pipeline.png({ compressionLevel: 9 });
      else if (type.mime === 'image/webp') pipeline = pipeline.webp({ quality: 92 });
      else if (type.mime === 'image/avif') pipeline = pipeline.avif({ quality: 70 });
      await pipeline.toFile(tmp);
      fs.renameSync(tmp, file);
      info.bytes = fs.statSync(file).size;
    }
    ensureDir(thumbFile);
    const t = await sharp(file, { animated: false }).rotate().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toFile(thumbFile);
    info.thumbBytes = t.size;
    return info;
  }
  if (!videoToolsAvailable()) return info;
  try {
    const { stdout } = await run(/** @type {string} */ (tools.ffprobe), ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeout: 30_000 });
    const probe = JSON.parse(stdout);
    const v = probe.streams?.find((/** @type {any} */ s) => s.codec_type === 'video');
    if (v) {
      const rot = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((/** @type {any} */ x) => x.rotation !== undefined)?.rotation ?? 0));
      const swap = rot === 90 || rot === 270;
      info.width = swap ? v.height : v.width;
      info.height = swap ? v.width : v.height;
      info.codec = v.codec_name ?? null;
    }
    const dur = Number(probe.format?.duration ?? v?.duration);
    if (Number.isFinite(dur)) info.duration_s = Math.round(dur * 10) / 10;
    const at = info.duration_s && info.duration_s > 2 ? '1' : '0';
    const { stdout: png } = await run(/** @type {string} */ (tools.ffmpeg), ['-v', 'error', '-ss', at, '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    });
    ensureDir(thumbFile);
    const t = await sharp(/** @type {Buffer} */ (/** @type {unknown} */ (png))).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 75 }).toFile(thumbFile);
    info.thumbBytes = t.size;
  } catch {
    // Metadata is best effort: the UI shows "—".
  }
  return info;
}

/**
 * Store a file from a stream (uploads).
 * @param {import('../app.js').App} app @param {import('../app.js').Workspace} ws
 * @param {{userId: string, body: ReadableStream<Uint8Array>|null, filename: string}} p
 */
export async function ingestStream(app, ws, p) {
  assertStorageRoom(app, ws);
  const tmp = path.join(ws.mediaDir, 'tmp', `${newId()}.upload`);
  const { bytes, sha256, head } = await streamToFile(p.body, tmp, app.config.maxUploadBytes);
  return finishIngest(app, ws, { tmp, bytes, sha256, head, userId: p.userId, filename: p.filename });
}

/**
 * Store a file from a buffer (seed icons, crops, favicons).
 * @param {import('../app.js').App} app @param {import('../app.js').Workspace} ws
 * @param {{userId: string|null, data: Buffer, filename: string, skipCap?: boolean}} p
 */
export async function ingestBuffer(app, ws, p) {
  if (!p.skipCap) assertStorageRoom(app, ws, p.data.length);
  const tmp = path.join(ws.mediaDir, 'tmp', `${newId()}.upload`);
  ensureDir(tmp);
  fs.writeFileSync(tmp, p.data);
  const sha256 = crypto.createHash('sha256').update(p.data).digest('hex');
  return finishIngest(app, ws, { tmp, bytes: p.data.length, sha256, head: p.data.subarray(0, 64), userId: p.userId, filename: p.filename, skipCap: p.skipCap });
}

/**
 * @param {import('../app.js').App} app @param {import('../app.js').Workspace} ws
 * @param {{tmp: string, bytes: number, sha256: string, head: Buffer, userId: string|null, filename: string, skipCap?: boolean}} p
 */
async function finishIngest(app, ws, p) {
  const type = detectType(p.head);
  if (!type) {
    fs.rmSync(p.tmp, { force: true });
    throw new ApiError(415, 'unsupported_media', 'Unsupported file type');
  }
  // Identical files are stored once; the uploader is recorded.
  const existing = /** @type {any} */ (ws.db.prepare('SELECT * FROM media WHERE sha256 = ?').get(p.sha256));
  if (existing) {
    fs.rmSync(p.tmp, { force: true });
    if (p.userId) ws.db.prepare('INSERT OR IGNORE INTO media_owners (media_id, user_id, created_at) VALUES (?, ?, ?)').run(existing.id, p.userId, isoNow());
    return mediaView(existing);
  }
  if (!p.skipCap) {
    try {
      assertStorageRoom(app, ws, p.bytes);
    } catch (err) {
      fs.rmSync(p.tmp, { force: true });
      throw err;
    }
  }
  const id = newId();
  const rel = relPath(id, type.ext, 'originals');
  const thumbRel = relPath(id, 'webp', 'thumbs');
  const file = abs(ws, rel);
  ensureDir(file);
  fs.renameSync(p.tmp, file);
  let info;
  try {
    info = await processFile(file, type, abs(ws, thumbRel));
  } catch (err) {
    fs.rmSync(file, { force: true });
    fs.rmSync(abs(ws, thumbRel), { force: true });
    throw err;
  }
  const row = {
    id,
    sha256: p.sha256,
    original_name: (p.filename || `upload.${type.ext}`).slice(0, 200),
    mime: type.mime,
    bytes: info.bytes,
    width: info.width,
    height: info.height,
    duration_s: info.duration_s,
    codec: info.codec,
    path: rel,
    thumb_path: info.thumbBytes ? thumbRel : null,
    thumb_bytes: info.thumbBytes,
    created_at: isoNow(),
  };
  ws.db.tx(() => {
    ws.db
      .prepare(
        `INSERT INTO media (id, sha256, original_name, mime, bytes, width, height, duration_s, codec, path, thumb_path, thumb_bytes, created_at)
         VALUES (:id, :sha256, :original_name, :mime, :bytes, :width, :height, :duration_s, :codec, :path, :thumb_path, :thumb_bytes, :created_at)`,
      )
      .run(row);
    if (p.userId) ws.db.prepare('INSERT OR IGNORE INTO media_owners (media_id, user_id, created_at) VALUES (?, ?, ?)').run(id, p.userId, row.created_at);
  });
  return mediaView(row);
}

/** API shape. @param {any} m */
export function mediaView(m) {
  return {
    id: m.id,
    original_name: m.original_name,
    mime: m.mime,
    kind: m.mime.startsWith('video/') ? 'video' : 'image',
    bytes: m.bytes,
    thumb_bytes: m.thumb_bytes,
    width: m.width,
    height: m.height,
    duration_s: m.duration_s,
    codec: m.codec ?? null,
    has_thumb: !!m.thumb_path,
    created_at: m.created_at,
    url: `/media/${m.id}/original`,
    thumb_url: m.thumb_path ? `/media/${m.id}/thumb` : null,
  };
}

/** @param {import('../app.js').Workspace} ws @param {string} id */
export function getMedia(ws, id) {
  return /** @type {any} */ (ws.db.prepare('SELECT * FROM media WHERE id = ?').get(id)) ?? null;
}

/** Where each media file is used (entries, posts, platforms). @param {import('../app.js').Workspace} ws @param {string} id */
export function usagesOf(ws, id) {
  return {
    entries: /** @type {any[]} */ (ws.db.prepare('SELECT id, title FROM entries WHERE cover_media_id = ?').all(id)),
    posts: /** @type {any[]} */ (ws.db.prepare('SELECT DISTINCT p.id, p.title FROM post_media pm JOIN posts p ON p.id = pm.post_id WHERE pm.media_id = ?').all(id)),
    platforms: /** @type {any[]} */ (ws.db.prepare('SELECT id, name AS title FROM platforms WHERE icon_media_id = ?').all(id)),
  };
}

const REFERENCED = `
  SELECT cover_media_id AS id FROM entries WHERE cover_media_id IS NOT NULL
  UNION SELECT media_id FROM post_media WHERE media_id IS NOT NULL
  UNION SELECT icon_media_id FROM platforms WHERE icon_media_id IS NOT NULL
  UNION SELECT value FROM settings WHERE key = 'sample_cover_media_id'`;

/**
 * The media library: images/videos, optionally only the caller's uploads.
 * @param {import('../app.js').Workspace} ws @param {{kind?: string, mine?: string|null, q?: string}} f
 */
export function listMedia(ws, f) {
  const where = [];
  /** @type {any[]} */ const args = [];
  if (f.kind === 'image') where.push("m.mime LIKE 'image/%'");
  if (f.kind === 'video') where.push("m.mime LIKE 'video/%'");
  if (f.mine) {
    where.push('EXISTS (SELECT 1 FROM media_owners o WHERE o.media_id = m.id AND o.user_id = ?)');
    args.push(f.mine);
  }
  if (f.q) {
    where.push('m.original_name LIKE ?');
    args.push(`%${f.q.replace(/[%_]/g, '')}%`);
  }
  // Seed icons and the sample cover are not library content.
  where.push("m.id NOT IN (SELECT icon_media_id FROM platforms WHERE icon_media_id IS NOT NULL)");
  const rows = ws.db.prepare(`SELECT m.* FROM media m ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.created_at DESC LIMIT 300`).all(...args);
  return rows.map(mediaView);
}

/**
 * Crop an image to {x, y, w, h} (source pixels) and store it as new media.
 * @param {import('../app.js').App} app @param {import('../app.js').Workspace} ws @param {string} userId @param {string} id
 * @param {{x: number, y: number, w: number, h: number}} r
 */
export async function cropMedia(app, ws, userId, id, r) {
  const m = getMedia(ws, id);
  if (!m) throw new ApiError(404, 'not_found');
  if (!m.mime.startsWith('image/')) throw new ApiError(415, 'unsupported_media', 'Only images can be cropped');
  if (r.x + r.w > m.width || r.y + r.h > m.height) throw new ApiError(400, 'validation_error', 'Crop outside the image', { fields: { crop: 'invalid_value' } });
  const fmt = m.mime === 'image/png' ? 'png' : m.mime === 'image/webp' ? 'webp' : 'jpeg';
  const data = await sharp(abs(ws, m.path)).rotate().extract({ left: r.x, top: r.y, width: r.w, height: r.h }).toFormat(fmt, { quality: 92 }).toBuffer();
  const base = (m.original_name ?? 'image').replace(/\.[a-z0-9]+$/i, '');
  return ingestBuffer(app, ws, { userId, data, filename: `${base}-16x9.${fmt === 'jpeg' ? 'jpg' : fmt}` });
}

/**
 * Delete media nothing references, older than the grace period (24 h by
 * default, for unsaved forms). Files are removed with their records.
 * @param {import('../app.js').App} _app @param {import('../app.js').Workspace} ws @param {{olderThanMs?: number, dryRun?: boolean}} [opts]
 */
export function cleanupMedia(_app, ws, opts = {}) {
  const cutoff = new Date(Date.now() - (opts.olderThanMs ?? 24 * HOUR)).toISOString();
  const rows = /** @type {any[]} */ (ws.db.prepare(`SELECT * FROM media WHERE created_at < ? AND id NOT IN (${REFERENCED})`).all(cutoff));
  const bytes = rows.reduce((n, m) => n + m.bytes + m.thumb_bytes, 0);
  if (opts.dryRun) return { removed: rows.length, bytes };
  for (const m of rows) {
    ws.db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
    fs.rmSync(abs(ws, m.path), { force: true });
    if (m.thumb_path) fs.rmSync(abs(ws, m.thumb_path), { force: true });
  }
  // Leftover temporary files from interrupted uploads.
  const tmpDir = path.join(ws.mediaDir, 'tmp');
  if (fs.existsSync(tmpDir)) {
    for (const f of fs.readdirSync(tmpDir)) {
      const p = path.join(tmpDir, f);
      if (fs.statSync(p).mtimeMs < Date.now() - HOUR) fs.rmSync(p, { force: true });
    }
  }
  return { removed: rows.length, bytes };
}

/** Unreferenced media (any age), for the storage breakdown. @param {import('../app.js').Workspace} ws */
export function unreferencedBytes(ws) {
  return /** @type {any} */ (ws.db.prepare(`SELECT COALESCE(SUM(bytes + thumb_bytes), 0) AS n FROM media WHERE id NOT IN (${REFERENCED})`).get()).n;
}

/** Absolute file path of a variant. @param {import('../app.js').Workspace} ws @param {any} m @param {'original'|'thumb'} variant */
export function fileOf(ws, m, variant) {
  if (variant === 'thumb') return m.thumb_path ? abs(ws, m.thumb_path) : null;
  return abs(ws, m.path);
}

/**
 * Seed media that must exist without the network: platform icons and the
 * demo sample cover. Idempotent.
 * @param {import('../app.js').App} app @param {import('../app.js').Workspace} ws
 */
export async function importSeedMedia(app, ws) {
  const dir = path.join(import.meta.dirname, '../seed');
  const platforms = /** @type {any[]} */ (ws.db.prepare('SELECT id, slug FROM platforms WHERE icon_media_id IS NULL').all());
  for (const p of platforms) {
    const file = path.join(dir, 'icons', `${p.slug}.png`);
    if (!fs.existsSync(file)) continue;
    const m = await ingestBuffer(app, ws, { userId: null, data: fs.readFileSync(file), filename: `${p.slug}.png`, skipCap: true });
    ws.db.prepare('UPDATE platforms SET icon_media_id = ? WHERE id = ?').run(m.id, p.id);
  }
  if (ws.name === 'demo' && !ws.db.prepare("SELECT 1 FROM settings WHERE key = 'sample_cover_media_id'").get()) {
    const m = await ingestBuffer(app, ws, { userId: null, data: fs.readFileSync(path.join(dir, 'sample-cover.webp')), filename: 'exemplu-copertă-16x9.webp', skipCap: true });
    ws.db.prepare("INSERT INTO settings (key, value) VALUES ('sample_cover_media_id', ?)").run(m.id);
  }
}
