// Import v1 data into a fresh v2 main workspace (§14): one transaction, with
// a dry run that prints the same report without changing anything.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { newId, isoNow } from '../util.js';
import * as repo from '../db/repos/entries.js';
import { entrySpan } from '../../shared/schemas/entry.js';
import { isHttpsUrl, isShareLink } from '../../shared/schemas/common.js';
import { ingestBuffer, importSeedMedia, purgeMedia } from '../services/media.js';
import { setSetting } from '../services/settings.js';
import { bookingsFromV1, cleanUsername, firstInt, nearestOwnerColor, parseCapacity, parseDurationSeconds, parseFileSizeMb, parsePrice, parseRatio, sessionsFromV1 } from './v1-parse.js';

/** @typedef {import('../app.js').App} App */

export const LEGACY_PREFIX = 'legacy-bcrypt:';

/**
 * @typedef {{
 *   counts: Record<string, number>,
 *   skipped: {kind: string, id: string, reason: string}[],
 *   warnings: {kind: string, id: string, code: string, detail?: string}[],
 *   passkeyUsers: string[],
 *   dryRun: boolean,
 * }} Report
 */

class DryRun extends Error {}

/** @param {string} url @param {string} prefix */
const uploadName = (url, prefix) => {
  const m = new RegExp(`^(?:https?://[^/]+)?${prefix.replace(/[/]/g, '\\/')}/([\\w.-]+)$`).exec(String(url ?? ''));
  return m ? m[1] : null;
};

/**
 * @param {App} app
 * @param {{users: any[], workspace: any, uploadsDir?: string|null, uploadsPrefix?: string, dryRun?: boolean}} input
 * @returns {Promise<Report>}
 */
export async function importV1(app, input) {
  const ws = app.workspaces.main;
  const db = ws.db;
  const tz = ws.tz();
  const prefix = input.uploadsPrefix ?? '/uploads';
  const data = { platforms: [], posts: [], events: [], spaces: [], rooms: [], ...(input.workspace ?? {}) };
  /** @type {Report} */
  const report = {
    counts: { users: 0, spaces: 0, rooms: 0, platforms: 0, formats: 0, entries: 0, sessions: 0, bookings: 0, series: 0, posts: 0, media: 0 },
    skipped: [],
    warnings: [],
    passkeyUsers: [],
    dryRun: !!input.dryRun,
  };
  const warn = (/** @type {string} */ kind, /** @type {string} */ id, /** @type {string} */ code, /** @type {string} */ detail = '') =>
    report.warnings.push({ kind, id: String(id), code, ...(detail ? { detail } : {}) });

  // Only into a fresh workspace.
  const n = (/** @type {string} */ sql) => /** @type {any} */ (db.prepare(sql).get()).n;
  if (n('SELECT COUNT(*) AS n FROM entries') || n('SELECT COUNT(*) AS n FROM posts')) {
    throw new Error('The main workspace is not empty: import-v1 only runs on a fresh install (no entries or posts). Start with SEED_SAMPLE_CONTENT=0.');
  }

  // Media first (async): uploads referenced by covers and posts. In a dry run
  // we only check the files exist.
  /** @type {Map<string, string>} */ const mediaIds = new Map();
  const referenced = new Set();
  for (const e of data.events) if (uploadName(e.facebookImage, prefix)) referenced.add(uploadName(e.facebookImage, prefix));
  for (const p of data.posts) for (const u of [p.mediaUrl, ...(Array.isArray(p.mediaUrls) ? p.mediaUrls : [])]) if (uploadName(u, prefix)) referenced.add(uploadName(u, prefix));
  for (const name of referenced) {
    const file = input.uploadsDir ? path.join(input.uploadsDir, /** @type {string} */ (name)) : null;
    if (!file || !fs.existsSync(file)) {
      warn('media', /** @type {string} */ (name), 'missing_file');
      continue;
    }
    if (input.dryRun) {
      mediaIds.set(/** @type {string} */ (name), `dry-${name}`);
      continue;
    }
    try {
      const m = await ingestBuffer(app, ws, { userId: null, data: fs.readFileSync(file), filename: /** @type {string} */ (name), skipCap: true });
      mediaIds.set(/** @type {string} */ (name), m.id);
    } catch (err) {
      warn('media', /** @type {string} */ (name), 'unsupported_file', /** @type {any} */ (err).code ?? String(err));
    }
  }
  report.counts.media = mediaIds.size;

  try {
    db.tx(() => {
      const now = isoNow();
      const root = /** @type {any} */ (db.prepare('SELECT * FROM auth.users WHERE is_root = 1').get());
      if (!root) throw new Error('No root admin: start the v2 server once before importing.');

      // ---- Users ----
      /** @type {Map<string, {id: string, name: string}>} */ const userMap = new Map();
      const taken = new Set(/** @type {any[]} */ (db.prepare('SELECT username FROM auth.users').all()).map((u) => u.username.toLowerCase()));
      for (const u of input.users ?? []) {
        if (u.isDemo) {
          report.skipped.push({ kind: 'user', id: String(u.id), reason: 'demo_user' });
          continue;
        }
        if ((u.passkeys ?? []).length) report.passkeyUsers.push(u.username);
        const role = ['admin', 'moderator', 'user'].includes(u.role) ? u.role : 'user';
        const hash = typeof u.passwordHash === 'string' && /^\$2[aby]\$/.test(u.passwordHash) ? `${LEGACY_PREFIX}${u.passwordHash}` : null;
        if (!hash) warn('user', u.username, 'no_password');
        let username = cleanUsername(u.username);
        const color = nearestOwnerColor(u.color);
        // The bootstrap root admin that was never set up takes over the v1 account with the same username.
        if (username === root.username.toLowerCase() && root.status === 'invited' && !root.password_hash && role === 'admin') {
          db.prepare('UPDATE auth.users SET name = ?, password_hash = ?, status = ?, color = ?, email = COALESCE(?, email), updated_at = ? WHERE id = ?').run(
            u.name ?? root.name, hash, hash ? 'active' : 'invited', color, u.email || null, now, root.id,
          );
          userMap.set(String(u.id), { id: root.id, name: u.name ?? root.name });
          report.counts.users++;
          continue;
        }
        if (taken.has(username)) {
          let i = 2;
          while (taken.has(`${username.slice(0, 29)}-${i}`)) i++;
          warn('user', u.username, 'username_renamed', `${username}-${i}`);
          username = `${username.slice(0, 29)}-${i}`;
        }
        taken.add(username);
        const email = typeof u.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) ? u.email.toLowerCase() : null;
        if (email && db.prepare('SELECT 1 FROM auth.users WHERE email = ?').get(email)) warn('user', u.username, 'email_taken', email);
        const id = newId();
        db.prepare(
          `INSERT INTO auth.users (id, username, email, name, role, is_root, is_demo, is_seed, status, password_hash, webauthn_user_id, color,
             created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
        ).run(id, username, email && !db.prepare('SELECT 1 FROM auth.users WHERE email = ?').get(email) ? email : null, String(u.name || username).slice(0, 80),
          role, hash ? 'active' : 'invited', hash, crypto.randomBytes(32).toString('base64url'), color, u.createdAt ? String(u.createdAt) : now, now);
        userMap.set(String(u.id), { id, name: u.name ?? username });
        report.counts.users++;
      }

      // ---- Spaces and rooms (replace the defaults of the fresh install) ----
      /** @type {Map<string, string>} */ const spaceMap = new Map();
      /** @type {Map<string, string>} */ const roomMap = new Map();
      if (data.spaces.length) db.prepare('DELETE FROM spaces').run();
      data.spaces.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
        const id = newId();
        spaceMap.set(String(s.id), id);
        db.prepare(
          `INSERT INTO spaces (id, name, capacity_people, color, description, enabled, position, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, String(s.name ?? `Spațiu ${i + 1}`).slice(0, 80), parseCapacity(s.capacity), nearestOwnerColor(s.color), s.description ?? null,
          s.enabled === false ? 0 : 1, i, now, root.id, now, root.id);
        report.counts.spaces++;
      });
      if (data.rooms.length) db.prepare('DELETE FROM rooms').run();
      data.rooms.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
        const id = newId();
        roomMap.set(String(r.id), id);
        db.prepare(
          `INSERT INTO rooms (id, name, room_type, capacity_guests, beds, color, notes, enabled, position, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, String(r.name ?? `Camera ${i + 1}`).slice(0, 80), r.type ?? null, Math.max(1, parseCapacity(r.capacity) ?? 2), r.beds ?? null,
          nearestOwnerColor(r.color), r.notes ?? null, r.enabled === false ? 0 : 1, i, now, root.id, now, root.id);
        report.counts.rooms++;
      });

      // ---- Platforms and formats ----
      /** @type {Map<string, string>} */ const platformMap = new Map();
      /** @type {Map<string, {id: string, platform: string}>} */ const formatMap = new Map();
      if (data.platforms.length) {
        db.prepare('DELETE FROM platforms').run();
        data.platforms.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
          const id = newId();
          const slug = cleanUsername(p.id ?? p.name).replace(/\./g, '-');
          platformMap.set(String(p.id), id);
          db.prepare(
            `INSERT INTO platforms (id, slug, name, color, domain, description, enabled, position, created_at, created_by, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(id, slug, String(p.name ?? slug).slice(0, 60), /^#[0-9a-f]{6}$/i.test(p.color ?? '') ? p.color : '#0f766e', p.domain ?? null,
            p.description ?? null, p.enabled === false ? 0 : 1, i, now, root.id, now, root.id);
          report.counts.platforms++;
          const types = Array.isArray(p.postTypes) && p.postTypes.length ? p.postTypes : [{ id: `${p.id}-post`, name: 'Postare', mediaType: 'photo', aspectRatio: '1:1' }];
          types.forEach((/** @type {any} */ f, /** @type {number} */ j) => {
            const fid = newId();
            formatMap.set(`${p.id}::${f.id}`, { id: fid, platform: id });
            const kind = f.mediaType === 'video' ? 'video' : f.mediaType === 'photos' ? 'carousel' : 'image';
            const ratio = parseRatio(f.aspectRatio) ?? [1, 1];
            if (!parseRatio(f.aspectRatio)) warn('format', f.id, 'ratio_unparsed', String(f.aspectRatio ?? ''));
            const duration = kind === 'video' ? parseDurationSeconds(f.maxDuration) : null;
            const items = kind === 'carousel' ? firstInt(/(\d+)\s*(photos?|slides?|images?|imagini|fotografii)/i.exec(String(f.maxDuration ?? ''))?.[1]) : null;
            db.prepare(
              `INSERT INTO formats (id, platform_id, name, media_kind, ratio_w, ratio_h, width, height, file_formats, max_duration_s, max_items,
                 max_file_mb, caption_limit, hook_length, safe_zone, duration_note, file_size_note, hook_note, position, created_at, created_by, updated_at, updated_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(fid, id, String(f.name ?? f.id).slice(0, 80), kind, ratio[0], ratio[1], firstInt(f.recommendedWidth) ?? 1080, firstInt(f.recommendedHeight) ?? 1080,
              f.format ?? null, duration, items, parseFileSizeMb(f.maxFileSize), firstInt(f.captionLimit) ?? 2200, firstInt(f.hookLength),
              f.safeZone ?? null, f.maxDuration ?? null, f.maxFileSize ?? null, typeof f.hookLength === 'string' ? f.hookLength : null, j, now, root.id, now, root.id);
            report.counts.formats++;
          });
        });
      } else {
        for (const p of /** @type {any[]} */ (db.prepare('SELECT id, slug FROM platforms').all())) platformMap.set(p.slug, p.id);
        for (const f of /** @type {any[]} */ (db.prepare('SELECT f.id, f.name, p.slug, p.id AS pid FROM formats f JOIN platforms p ON p.id = f.platform_id').all())) {
          formatMap.set(`${f.slug}::${f.name}`, { id: f.id, platform: f.pid });
        }
      }

      // ---- Entries ----
      /** @type {Map<string, string>} */ const entryMap = new Map();
      /** @type {Map<string, {id: string, dates: string[], total: number}>} */ const seriesMap = new Map();
      for (const e of data.events) {
        const type = e.entryType === 'locked' ? 'blocked' : e.entryType === 'room_only' ? 'room_only' : 'event';
        const owner = userMap.get(String(e.creatorId));
        if (!owner) warn('entry', e.id, 'owner_unknown', e.creatorName ?? e.creatorId ?? '');
        const sessions = sessionsFromV1(e);
        const bookings = bookingsFromV1(e)
          .map((b) => {
            const rid = roomMap.get(String(b.roomId));
            if (!rid) warn('entry', e.id, 'room_unknown', b.roomId);
            return rid ? { room_id: rid, check_in: b.check_in, check_out: b.check_out, guests: 1, guest_names: e.guestName ?? e.guestNames ?? null } : null;
          })
          .filter(Boolean);
        if (!sessions.length && !bookings.length) {
          report.skipped.push({ kind: 'entry', id: String(e.id), reason: 'no_dates' });
          continue;
        }
        const span = entrySpan({ sessions, room_bookings: /** @type {any[]} */ (bookings) });
        const price = type === 'event' ? parsePrice(e.price, e.currency) : { price_cents: null, currency: null, price_note: null, warning: null };
        if (price.warning) warn('entry', e.id, price.warning, String(e.price));
        let cover_media_id = null;
        let cover_url = null;
        if (type === 'event' && e.facebookImage) {
          const name = uploadName(e.facebookImage, prefix);
          if (name) cover_media_id = input.dryRun ? null : mediaIds.get(name) ?? null;
          else if (isHttpsUrl(e.facebookImage)) cover_url = e.facebookImage;
          else warn('entry', e.id, 'cover_invalid', String(e.facebookImage).slice(0, 80));
        }
        const description = [e.description, e.location ? `Locație: ${e.location}` : null].filter(Boolean).join('\n\n') || null;
        let series_id = null;
        let occurrence_index = null;
        if (e.isRecurrent && e.recurrenceGroupId) {
          let s = seriesMap.get(String(e.recurrenceGroupId));
          if (!s) {
            s = { id: newId(), dates: [], total: Number(e.recurrenceTotal) || 1 };
            seriesMap.set(String(e.recurrenceGroupId), s);
          }
          s.dates.push(span.first ?? e.startDate);
          series_id = s.id;
          occurrence_index = Math.max(0, (Number(e.recurrenceIndex) || 1) - 1);
        }
        const id = newId();
        entryMap.set(String(e.id), id);
        const promotion = type !== 'event' ? null : e.socialStatus === 'promoted' ? 'promoted' : e.socialStatus === 'skipped' ? 'skipped' : e.socialStatus === 'none' ? null : 'pending';
        // Series rows must exist before entries reference them.
        if (series_id && !db.prepare('SELECT 1 FROM series WHERE id = ?').get(series_id)) {
          db.prepare("INSERT INTO series (id, start_date, end_date, rule, exceptions, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?)").run(
            series_id, span.first, span.last, JSON.stringify({ freq: 'monthly_day', interval: 1, count: seriesMap.get(String(e.recurrenceGroupId))?.total }), now, root.id, now, root.id,
          );
          report.counts.series++;
        }
        repo.insertEntryRow(
          db,
          {
            id, type, title: String(e.title ?? '(fără titlu)').slice(0, 120), description, owner_id: owner?.id ?? root.id,
            owner_name_snapshot: owner?.name ?? e.creatorName ?? root.name, space_id: type === 'room_only' ? null : spaceMap.get(String(e.spaceId)) ?? null,
            price_cents: price.price_cents, currency: price.currency, price_note: price.price_note,
            enroll_url: type === 'event' && isHttpsUrl(e.enrollLink ?? '') ? e.enrollLink : null,
            cover_media_id, cover_url, promotion_status: promotion, series_id, occurrence_index, allow_overlap: false,
            first_date: span.first, last_date: span.last,
          },
          owner?.id ?? root.id,
        );
        if (type === 'event' && e.enrollLink && !isHttpsUrl(e.enrollLink)) warn('entry', e.id, 'enroll_url_invalid', String(e.enrollLink).slice(0, 80));
        repo.writeChildren(db, id, sessions, /** @type {any[]} */ (bookings), tz);
        report.counts.entries++;
        report.counts.sessions += sessions.length;
        report.counts.bookings += bookings.length;
      }
      for (const s of seriesMap.values()) {
        const dates = s.dates.sort();
        db.prepare('UPDATE series SET start_date = ?, end_date = ? WHERE id = ?').run(dates[0], dates[dates.length - 1], s.id);
      }

      // ---- Posts ----
      /** @type {Map<string, string>} */ const postMap = new Map();
      for (const p of data.posts) {
        const fmt = formatMap.get(`${p.platformId}::${p.postTypeId}`);
        const pid = fmt?.platform ?? platformMap.get(String(p.platformId));
        const formatId = fmt?.id ?? (pid ? /** @type {any} */ (db.prepare('SELECT id FROM formats WHERE platform_id = ? ORDER BY position LIMIT 1').get(pid))?.id : null);
        if (!pid || !formatId) {
          report.skipped.push({ kind: 'post', id: String(p.id), reason: 'unknown_platform' });
          continue;
        }
        if (!fmt) warn('post', p.id, 'format_unknown', String(p.postTypeId ?? ''));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '')) {
          report.skipped.push({ kind: 'post', id: String(p.id), reason: 'no_date' });
          continue;
        }
        const id = newId();
        postMap.set(String(p.id), id);
        const status = ['draft', 'scheduled', 'published'].includes(p.status) ? p.status : 'draft';
        const share = typeof p.shareLink === 'string' && p.shareLink.trim() ? p.shareLink.trim() : null;
        if (share && !isShareLink(share)) warn('post', p.id, 'share_link_invalid', share.slice(0, 80));
        db.prepare(
          `INSERT INTO posts (id, platform_id, format_id, publish_date, publish_time, title, caption, status, share_link, event_id,
             created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        ).run(id, pid, formatId, p.date, /^\d{2}:\d{2}$/.test(p.time ?? '') ? p.time : '12:00', String(p.title || '(fără titlu)').slice(0, 200),
          String(p.description ?? ''), status, share && isShareLink(share) ? share : null, now, root.id, now, root.id);
        const urls = [...new Set([...(Array.isArray(p.mediaUrls) ? p.mediaUrls : []), p.mediaUrl].filter(Boolean))];
        let pos = 0;
        for (const u of urls) {
          const name = uploadName(u, prefix);
          if (name) {
            const mid = mediaIds.get(name);
            if (mid && !input.dryRun) db.prepare('INSERT INTO post_media (post_id, position, media_id, external_url) VALUES (?, ?, ?, NULL)').run(id, pos++, mid);
            else if (mid) pos++;
          } else if (isHttpsUrl(u)) {
            db.prepare('INSERT INTO post_media (post_id, position, media_id, external_url) VALUES (?, ?, NULL, ?)').run(id, pos++, u);
          } else warn('post', p.id, 'media_url_invalid', String(u).slice(0, 80));
        }
        report.counts.posts++;
      }

      // ---- Promotion links: promotedPostId → posts.event_id ----
      for (const e of data.events) {
        if (!e.promotedPostId) continue;
        const eid = entryMap.get(String(e.id));
        const pid = postMap.get(String(e.promotedPostId));
        if (eid && pid) db.prepare('UPDATE posts SET event_id = ? WHERE id = ?').run(eid, pid);
        else warn('entry', e.id, 'promoted_post_missing', String(e.promotedPostId));
      }

      if (input.dryRun) throw new DryRun();
      const passkeyIds = (input.users ?? []).filter((u) => !u.isDemo && (u.passkeys ?? []).length).map((u) => userMap.get(String(u.id))?.id).filter(Boolean);
      setSetting(db, 'v1_imported_at', now);
      setSetting(db, 'v1_passkey_users', JSON.stringify(passkeyIds));
      repo.audit(db, { userId: root.id, action: 'import.v1', entity: 'import', entityId: null, details: { counts: report.counts, warnings: report.warnings.length } });
    });
  } catch (err) {
    if (err instanceof DryRun) return report;
    // Undo the media we ingested for this failed run.
    purgeMedia(ws, mediaIds.values());
    throw err;
  }
  // Icons for platforms whose slug matches a shipped icon.
  await importSeedMedia(app, ws);
  return report;
}

/** A readable report for the console. @param {Report} r */
export function formatReport(r) {
  const lines = [r.dryRun ? '== import-v1: DRY RUN (nothing was changed) ==' : '== import-v1: done =='];
  lines.push('', 'Imported:');
  for (const [k, v] of Object.entries(r.counts)) lines.push(`  ${k.padEnd(10)} ${v}`);
  if (r.skipped.length) {
    lines.push('', `Skipped (${r.skipped.length}):`);
    for (const s of r.skipped) lines.push(`  ${s.kind} ${s.id}: ${s.reason}`);
  }
  if (r.warnings.length) {
    lines.push('', `Warnings (${r.warnings.length}):`);
    for (const w of r.warnings) lines.push(`  ${w.kind} ${w.id}: ${w.code}${w.detail ? ` — ${w.detail}` : ''}`);
  }
  if (r.passkeyUsers.length) {
    lines.push('', 'Passkeys are not migrated. These users sign in with their password and add a new passkey:');
    for (const u of r.passkeyUsers) lines.push(`  ${u}`);
  }
  return lines.join('\n');
}
