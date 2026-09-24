import { dbFileSize } from "../db/open.js";
import { audit } from "../db/repos/entries.js";
import { addDays, todayIn } from "../../shared/rules/time.js";
import { mediaView, purgeMedia, unreferencedIds, usagesOf } from "./media.js";

/** @typedef {import('../app.js').App} App */
/** @typedef {import('../app.js').Workspace} Workspace */

/**
 * Storage usage of a workspace: media bytes (originals + thumbnails) plus the
 * database file. Thresholds: 80 % warn, 90 % critical, 100 % full.
 * @param {App} app
 * @param {Workspace} ws
 */
export function storageStatus(app, ws) {
  const row = /** @type {any} */ (
    ws.db
      .prepare("SELECT COALESCE(SUM(bytes + thumb_bytes), 0) AS n FROM media")
      .get()
  );
  const dbBytes = dbFileSize(ws.db.file);
  const used = row.n + dbBytes;
  const cap = ws.capBytes();
  const pct = cap > 0 ? used / cap : 0;
  const level =
    pct >= 1 ? "full" : pct >= 0.9 ? "critical" : pct >= 0.8 ? "warn" : null;
  return { used, cap, pct, level, dbBytes, mediaBytes: row.n };
}

/**
 * The storage page: meter, breakdown (event covers, post media, other
 * referenced media such as icons, unreferenced, database) and the 20
 * largest files with where they are used.
 * @param {App} app @param {Workspace} ws
 */
export function storageReport(app, ws) {
  const status = storageStatus(app, ws);
  const media = /** @type {any[]} */ (
    ws.db.prepare("SELECT * FROM media").all()
  );
  const covers = new Set(
    /** @type {any[]} */ (
      ws.db
        .prepare(
          "SELECT cover_media_id AS id FROM entries WHERE cover_media_id IS NOT NULL",
        )
        .all()
    ).map((r) => r.id),
  );
  const posts = new Set(
    /** @type {any[]} */ (
      ws.db
        .prepare(
          "SELECT media_id AS id FROM post_media WHERE media_id IS NOT NULL",
        )
        .all()
    ).map((r) => r.id),
  );
  const free = unreferencedIds(ws);
  const breakdown = {
    covers: 0,
    posts: 0,
    other: 0,
    unreferenced: 0,
    database: status.dbBytes,
  };
  for (const m of media) {
    const n = m.bytes + m.thumb_bytes;
    if (covers.has(m.id)) breakdown.covers += n;
    else if (posts.has(m.id)) breakdown.posts += n;
    else if (free.has(m.id)) breakdown.unreferenced += n;
    else breakdown.other += n;
  }
  const largest = [...media]
    .sort((a, b) => b.bytes + b.thumb_bytes - (a.bytes + a.thumb_bytes))
    .slice(0, 20)
    .map((m) => ({
      ...mediaView(m),
      total_bytes: m.bytes + m.thumb_bytes,
      unreferenced: free.has(m.id),
      usages: usagesOf(ws, m.id),
    }));
  return { ...status, breakdown, files: media.length, largest };
}

export const CLEANUP_TOOLS = /** @type {const} */ ([
  "past-entries",
  "past-covers",
  "post-media",
  "unreferenced",
  "guest-names",
]);

class Rollback extends Error {}

/**
 * Run (or preview) a cleanup tool. The change runs in one transaction; the
 * preview runs the same statements and rolls back, so its count and bytes
 * are exactly what the real run frees. Media that becomes unreferenced is
 * deleted right away rather than waiting for the hourly job.
 * @param {App} app @param {Workspace} ws @param {{id: string}} actor
 * @param {typeof CLEANUP_TOOLS[number]} tool @param {{olderThanDays?: number}} params @param {boolean} dryRun
 * @returns {{count: number, bytes: number}}
 */
export function runCleanup(app, ws, actor, tool, params, dryRun) {
  const today = todayIn(ws.tz());
  const days = Math.max(0, params.olderThanDays ?? 0);
  const cutoff = addDays(today, -days);
  const before = unreferencedIds(ws);
  let count = 0;
  /** @type {Set<string>} */ let freed = new Set();
  let bytes = 0;
  try {
    ws.db.tx(() => {
      if (tool === "past-entries") {
        // Past = the last day is over; "older than N days" counts from that day.
        const ids = /** @type {any[]} */ (
          ws.db
            .prepare("SELECT id, series_id FROM entries WHERE last_date < ?")
            .all(cutoff)
        );
        count = ids.length;
        const del = ws.db.prepare("DELETE FROM entries WHERE id = ?");
        for (const r of ids) del.run(r.id);
        ws.db
          .prepare(
            "DELETE FROM series WHERE id NOT IN (SELECT DISTINCT series_id FROM entries WHERE series_id IS NOT NULL)",
          )
          .run();
      } else if (tool === "past-covers") {
        count = Number(
          ws.db
            .prepare(
              "UPDATE entries SET cover_media_id = NULL, cover_url = NULL WHERE type = 'event' AND last_date < ? AND (cover_media_id IS NOT NULL OR cover_url IS NOT NULL)",
            )
            .run(today).changes,
        );
      } else if (tool === "post-media") {
        const posts = /** @type {any[]} */ (
          ws.db
            .prepare(
              "SELECT DISTINCT p.id FROM posts p JOIN post_media pm ON pm.post_id = p.id WHERE p.status = 'published' AND p.publish_date < ?",
            )
            .all(cutoff)
        );
        count = posts.length;
        const del = ws.db.prepare("DELETE FROM post_media WHERE post_id = ?");
        for (const p of posts) del.run(p.id);
      } else if (tool === "unreferenced") {
        count = before.size;
      } else if (tool === "guest-names") {
        count = Number(
          ws.db
            .prepare(
              "UPDATE room_bookings SET guest_names = NULL WHERE check_out < ? AND guest_names IS NOT NULL AND guest_names <> ''",
            )
            .run(cutoff).changes,
        );
      }
      const after = unreferencedIds(ws);
      freed =
        tool === "unreferenced"
          ? after
          : new Set([...after].filter((id) => !before.has(id)));
      bytes = freed.size
        ? /** @type {any} */ (
            ws.db
              .prepare(
                "SELECT COALESCE(SUM(bytes + thumb_bytes), 0) AS n FROM media WHERE id IN (SELECT value FROM json_each(?))",
              )
              .get(JSON.stringify([...freed]))
          ).n
        : 0;
      if (dryRun) throw new Rollback();
      audit(ws.db, {
        userId: actor.id,
        action: `storage.cleanup.${tool}`,
        entity: "storage",
        entityId: null,
        details: { olderThanDays: days, count, bytes },
      });
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
    return { count, bytes };
  }
  purgeMedia(ws, freed);
  return { count, bytes };
}
