import { dbFileSize } from '../db/open.js';

/**
 * Storage usage of a workspace: media bytes (originals + thumbnails) plus the
 * database file. Thresholds: 80 % warn, 90 % critical, 100 % full.
 * @param {import('../app.js').App} app
 * @param {import('../app.js').Workspace} ws
 */
export function storageStatus(app, ws) {
  const row = /** @type {any} */ (ws.db.prepare('SELECT COALESCE(SUM(bytes + thumb_bytes), 0) AS n FROM media').get());
  const dbBytes = dbFileSize(ws.db.file);
  const used = row.n + dbBytes;
  const cap = ws.capBytes();
  const pct = cap > 0 ? used / cap : 0;
  const level = pct >= 1 ? 'full' : pct >= 0.9 ? 'critical' : pct >= 0.8 ? 'warn' : null;
  return { used, cap, pct, level, dbBytes, mediaBytes: row.n };
}
