// Social planner (§6): platforms, formats, posts, export/import.
import { newId, isoNow } from '../util.js';
import { ApiError, badRequest, conflict, notFound } from '../http/errors.js';
import { audit } from '../db/repos/entries.js';
import { DEFAULT_FORMATS, EXPORT_SCHEMA_VERSION } from '../../shared/schemas/social.js';
import { kindOfUrl, scheduleBlockers } from '../../shared/rules/media-rules.js';
import { isPastMoment } from '../../shared/rules/time.js';
import { getMedia, ingestBuffer, mediaView } from './media.js';
import sample from '../seed/sample-content.json' with { type: 'json' };

/** @typedef {import('../app.js').App} App */
/** @typedef {import('../app.js').Workspace} Workspace */
/** @typedef {{id: string, role: string}} Actor */

export const PLATFORM_COLS = ['name', 'color', 'domain', 'description', 'enabled', 'icon_media_id'];
export const FORMAT_COLS = [
  'name', 'media_kind', 'ratio_w', 'ratio_h', 'width', 'height', 'file_formats', 'min_duration_s', 'max_duration_s', 'max_items',
  'max_file_mb', 'caption_limit', 'hook_length', 'safe_zone', 'duration_note', 'file_size_note', 'hook_note',
];

/** @param {Record<string, any>} data @param {string[]} cols */
function pick(data, cols) {
  /** @type {Record<string, any>} */ const out = {};
  for (const c of cols) if (c in data) out[c] = typeof data[c] === 'boolean' ? (data[c] ? 1 : 0) : data[c] ?? null;
  return out;
}

/** @param {import('../db/open.js').Db} db @param {string} table @param {Record<string, any>} row */
function insert(db, table, row) {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`).run(row);
}

/** @param {string} s */
export const slugify = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'platforma';

// ---- Platforms -------------------------------------------------------------

/** @param {any} f @param {number} [posts] */
export function formatView(f, posts = 0) {
  const { created_by: _c, updated_by: _u, ...rest } = f;
  return { ...rest, ratio: `${f.ratio_w}:${f.ratio_h}`, post_count: posts };
}

/** @param {any} p */
export const iconUrl = (p) =>
  p.icon_media_id ? `/media/${p.icon_media_id}/original` : p.favicon_media_id ? `/media/${p.favicon_media_id}/original` : null;

/**
 * Every platform with its formats and post counts, in display order.
 * @param {Workspace} ws
 */
export function listPlatforms(ws) {
  const db = ws.db;
  const platforms = /** @type {any[]} */ (db.prepare('SELECT * FROM platforms ORDER BY position, name').all());
  const formats = /** @type {any[]} */ (db.prepare('SELECT * FROM formats ORDER BY position, name').all());
  const counts = new Map(
    /** @type {any[]} */ (db.prepare('SELECT format_id, COUNT(*) AS n FROM posts GROUP BY format_id').all()).map((r) => [r.format_id, r.n]),
  );
  return platforms.map((p) => {
    const fs = formats.filter((f) => f.platform_id === p.id).map((f) => formatView(f, counts.get(f.id) ?? 0));
    return platformView(p, fs);
  });
}

/** @param {any} p @param {any[]} formats */
function platformView(p, formats) {
  const { created_by: _c, updated_by: _u, ...rest } = p;
  return {
    ...rest,
    enabled: !!p.enabled,
    icon_url: iconUrl(p),
    formats,
    post_count: formats.reduce((n, f) => n + f.post_count, 0),
  };
}

/** @param {Workspace} ws @param {string} id */
export function getPlatform(ws, id) {
  const p = listPlatforms(ws).find((x) => x.id === id);
  if (!p) throw notFound();
  return p;
}

/** @param {Workspace} ws @param {string} name */
function uniqueSlug(ws, name) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ws.db.prepare('SELECT 1 FROM platforms WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`;
  return slug;
}

/** @param {Workspace} ws @param {string} id */
function assertMediaExists(ws, id) {
  if (id && !getMedia(ws, id)) throw badRequest('validation_error', { fields: { icon_media_id: 'not_found' } });
}

/**
 * Add a platform. It starts with two formats: a 4:5 image and a 9:16 video.
 * @param {App} app @param {Workspace} ws @param {Actor} actor @param {Record<string, any>} data
 */
export function createPlatform(app, ws, actor, data) {
  if (data.icon_media_id) assertMediaExists(ws, data.icon_media_id);
  const id = newId();
  ws.db.tx(() => {
    const now = isoNow();
    const pos = /** @type {any} */ (ws.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM platforms').get()).p;
    insert(ws.db, 'platforms', {
      id, slug: uniqueSlug(ws, data.name), ...pick({ enabled: true, ...data }, PLATFORM_COLS), position: pos,
      created_at: now, created_by: actor.id, updated_at: now, updated_by: actor.id,
    });
    DEFAULT_FORMATS.forEach((f, i) => insertFormat(ws, actor, id, f, i));
    audit(ws.db, { userId: actor.id, action: 'platform.create', entity: 'platform', entityId: id, details: { name: data.name } });
  });
  refreshFavicon(app, ws, id);
  return getPlatform(ws, id);
}

/** @param {Workspace} ws @param {Actor} actor @param {string} platformId @param {Record<string, any>} f @param {number} position */
function insertFormat(ws, actor, platformId, f, position) {
  const now = isoNow();
  const id = newId();
  insert(ws.db, 'formats', {
    id, platform_id: platformId, caption_limit: 2200, ...pick(f, FORMAT_COLS), position,
    created_at: now, created_by: actor?.id ?? null, updated_at: now, updated_by: actor?.id ?? null,
  });
  return id;
}

/**
 * @param {App} app @param {Workspace} ws @param {Actor} actor @param {string} id
 * @param {Record<string, any>} data @param {number} version
 */
export function updatePlatform(app, ws, actor, id, data, version) {
  const cur = /** @type {any} */ (ws.db.prepare('SELECT * FROM platforms WHERE id = ?').get(id));
  if (!cur) throw notFound();
  if (cur.version !== version) throw conflict('version_conflict', { current: cur.version });
  if (data.icon_media_id) assertMediaExists(ws, data.icon_media_id);
  const fields = pick(data, PLATFORM_COLS);
  const domainChanged = 'domain' in fields && fields.domain !== cur.domain;
  if (domainChanged) fields.favicon_media_id = null;
  const sets = Object.keys(fields).map((c) => `${c} = :${c}`);
  ws.db.tx(() => {
    const res = ws.db
      .prepare(`UPDATE platforms SET ${[...sets, 'version = version + 1', 'updated_at = :now', 'updated_by = :actor'].join(', ')} WHERE id = :id AND version = :version`)
      .run({ ...fields, now: isoNow(), actor: actor.id, id, version });
    if (!res.changes) throw conflict('version_conflict');
    audit(ws.db, { userId: actor.id, action: 'platform.update', entity: 'platform', entityId: id, details: Object.keys(fields) });
  });
  if (domainChanged) refreshFavicon(app, ws, id);
  return getPlatform(ws, id);
}

/**
 * Delete a platform. With posts, the caller chooses: move them to another
 * platform (with a format mapping) or delete them, and types the name.
 * @param {Workspace} ws @param {Actor} actor @param {string} id @param {number} version
 * @param {{mode?: 'move'|'delete', confirmName?: string, targetPlatformId?: string, formatMap?: Record<string, string>}} opts
 */
export function deletePlatform(ws, actor, id, version, opts) {
  const cur = /** @type {any} */ (ws.db.prepare('SELECT * FROM platforms WHERE id = ?').get(id));
  if (!cur) throw notFound();
  if (cur.version !== version) throw conflict('version_conflict', { current: cur.version });
  const total = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM platforms').get()).n;
  if (total <= 1) throw conflict('last_platform');
  const posts = /** @type {any[]} */ (ws.db.prepare('SELECT id, format_id, event_id FROM posts WHERE platform_id = ?').all(id));
  ws.db.tx(() => {
    if (posts.length) {
      if (!opts.mode) throw conflict('in_use', { count: posts.length });
      if ((opts.confirmName ?? '').trim() !== cur.name) throw badRequest('validation_error', { fields: { confirmName: 'confirm_mismatch' } });
      if (opts.mode === 'move') {
        const target = /** @type {any} */ (ws.db.prepare('SELECT id FROM platforms WHERE id = ?').get(opts.targetPlatformId ?? ''));
        if (!target || target.id === id) throw badRequest('validation_error', { fields: { targetPlatformId: 'invalid_value' } });
        const targetFormats = new Set(
          /** @type {any[]} */ (ws.db.prepare('SELECT id FROM formats WHERE platform_id = ?').all(target.id)).map((r) => r.id),
        );
        const map = opts.formatMap ?? {};
        for (const fid of new Set(posts.map((p) => p.format_id))) {
          if (!targetFormats.has(map[fid])) throw badRequest('validation_error', { fields: { [`formatMap.${fid}`]: 'required' } });
        }
        const move = ws.db.prepare('UPDATE posts SET platform_id = ?, format_id = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?');
        for (const p of posts) move.run(target.id, map[p.format_id], isoNow(), actor.id, p.id);
      } else {
        ws.db.prepare('DELETE FROM posts WHERE platform_id = ?').run(id);
        syncPromotion(ws, posts.map((p) => p.event_id));
      }
    }
    ws.db.prepare('DELETE FROM platforms WHERE id = ?').run(id);
    audit(ws.db, { userId: actor.id, action: 'platform.delete', entity: 'platform', entityId: id, details: { name: cur.name, posts: posts.length, mode: opts.mode ?? null } });
  });
}

/** @param {Workspace} ws @param {string[]} ids */
export function reorderPlatforms(ws, ids) {
  reorder(ws, 'SELECT id FROM platforms ORDER BY position', 'UPDATE platforms SET position = ? WHERE id = ?', ids);
}

/** @param {Workspace} ws @param {string} sql @param {string} upd @param {string[]} ids @param {any[]} [args] */
function reorder(ws, sql, upd, ids, args = []) {
  ws.db.tx(() => {
    const all = /** @type {any[]} */ (ws.db.prepare(sql).all(...args)).map((r) => r.id);
    const order = [...ids.filter((x) => all.includes(x)), ...all.filter((x) => !ids.includes(x))];
    const st = ws.db.prepare(upd);
    order.forEach((id, i) => st.run(i, id));
  });
}

/**
 * Reset platforms and formats to the defaults. Posts are never touched:
 * formats and custom platforms that posts use are kept.
 * @param {App} app @param {Workspace} ws @param {Actor} actor
 */
export function resetPlatforms(app, ws, actor) {
  ws.db.tx(() => {
    const now = isoNow();
    const used = new Set(/** @type {any[]} */ (ws.db.prepare('SELECT DISTINCT format_id FROM posts').all()).map((r) => r.format_id));
    const bySlug = new Map(/** @type {any[]} */ (ws.db.prepare('SELECT * FROM platforms').all()).map((p) => [p.slug, p]));
    let pos = 0;
    for (const def of sample.platforms) {
      let p = bySlug.get(def.slug);
      bySlug.delete(def.slug);
      if (!p) {
        const id = newId();
        insert(ws.db, 'platforms', {
          id, slug: def.slug, name: def.name, color: def.color, domain: def.domain, description: def.description, enabled: 1,
          position: pos, created_at: now, created_by: actor.id, updated_at: now, updated_by: actor.id,
        });
        p = { id };
      } else {
        ws.db
          .prepare(`UPDATE platforms SET name = ?, color = ?, domain = ?, description = ?, enabled = 1, position = ?,
            version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?`)
          .run(def.name, def.color, def.domain, def.description, pos, now, actor.id, p.id);
      }
      pos++;
      const existing = /** @type {any[]} */ (ws.db.prepare('SELECT * FROM formats WHERE platform_id = ?').all(p.id));
      const byName = new Map(existing.map((f) => [f.name, f]));
      def.formats.forEach((f, i) => {
        const row = pick(f, FORMAT_COLS);
        const cur = byName.get(f.name);
        byName.delete(f.name);
        if (cur) {
          const sets = Object.keys(row).map((c) => `${c} = :${c}`).join(', ');
          ws.db.prepare(`UPDATE formats SET ${sets}, position = :position, version = version + 1, updated_at = :now, updated_by = :actor WHERE id = :id`)
            .run({ ...row, position: i, now, actor: actor.id, id: cur.id });
        } else insertFormat(ws, actor, p.id, f, i);
      });
      let extra = def.formats.length;
      for (const f of byName.values()) {
        if (used.has(f.id)) ws.db.prepare('UPDATE formats SET position = ? WHERE id = ?').run(extra++, f.id);
        else ws.db.prepare('DELETE FROM formats WHERE id = ?').run(f.id);
      }
    }
    // Custom platforms: removed unless posts use them.
    for (const p of bySlug.values()) {
      const n = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE platform_id = ?').get(p.id)).n;
      if (n) ws.db.prepare('UPDATE platforms SET position = ? WHERE id = ?').run(pos++, p.id);
      else ws.db.prepare('DELETE FROM platforms WHERE id = ?').run(p.id);
    }
    audit(ws.db, { userId: actor.id, action: 'platform.reset', entity: 'platform', entityId: null });
  });
}

// ---- Formats ---------------------------------------------------------------

/** @param {Workspace} ws @param {string} platformId @param {string} id */
function formatRow(ws, platformId, id) {
  const f = /** @type {any} */ (ws.db.prepare('SELECT * FROM formats WHERE id = ? AND platform_id = ?').get(id, platformId));
  if (!f) throw notFound();
  return f;
}

/** @param {Workspace} ws @param {Actor} actor @param {string} platformId @param {Record<string, any>} data */
export function createFormat(ws, actor, platformId, data) {
  if (!ws.db.prepare('SELECT 1 FROM platforms WHERE id = ?').get(platformId)) throw notFound();
  let id = '';
  ws.db.tx(() => {
    const pos = /** @type {any} */ (ws.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM formats WHERE platform_id = ?').get(platformId)).p;
    id = insertFormat(ws, actor, platformId, data, pos);
    audit(ws.db, { userId: actor.id, action: 'format.create', entity: 'format', entityId: id, details: { name: data.name } });
  });
  return formatView(formatRow(ws, platformId, id));
}

/**
 * @param {Workspace} ws @param {Actor} actor @param {string} platformId @param {string} id
 * @param {Record<string, any>} data @param {number} version
 */
export function updateFormat(ws, actor, platformId, id, data, version) {
  const cur = formatRow(ws, platformId, id);
  if (cur.version !== version) throw conflict('version_conflict', { current: cur.version });
  const merged = { ...cur, ...data };
  if (merged.min_duration_s != null && merged.max_duration_s != null && merged.min_duration_s > merged.max_duration_s) {
    throw badRequest('validation_error', { fields: { max_duration_s: 'max_below_min' } });
  }
  const fields = pick(data, FORMAT_COLS);
  const sets = Object.keys(fields).map((c) => `${c} = :${c}`);
  ws.db.tx(() => {
    ws.db
      .prepare(`UPDATE formats SET ${[...sets, 'version = version + 1', 'updated_at = :now', 'updated_by = :actor'].join(', ')} WHERE id = :id`)
      .run({ ...fields, now: isoNow(), actor: actor.id, id });
    audit(ws.db, { userId: actor.id, action: 'format.update', entity: 'format', entityId: id, details: Object.keys(fields) });
  });
  const n = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE format_id = ?').get(id)).n;
  return formatView(formatRow(ws, platformId, id), n);
}

/**
 * Delete a format. A platform keeps at least one; a format posts use is
 * refused with 409 in_use unless `moveTo` names another format of the
 * same platform to move them to first.
 * @param {Workspace} ws @param {Actor} actor @param {string} platformId @param {string} id @param {number} version @param {{moveTo?: string}} opts
 */
export function deleteFormat(ws, actor, platformId, id, version, opts) {
  const cur = formatRow(ws, platformId, id);
  if (cur.version !== version) throw conflict('version_conflict', { current: cur.version });
  const count = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM formats WHERE platform_id = ?').get(platformId)).n;
  if (count <= 1) throw conflict('last_format');
  const used = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE format_id = ?').get(id)).n;
  ws.db.tx(() => {
    if (used) {
      if (!opts.moveTo) throw conflict('in_use', { count: used });
      if (opts.moveTo === id) throw badRequest('validation_error', { fields: { moveTo: 'invalid_value' } });
      formatRow(ws, platformId, opts.moveTo);
      ws.db.prepare('UPDATE posts SET format_id = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE format_id = ?').run(opts.moveTo, isoNow(), actor.id, id);
    }
    ws.db.prepare('DELETE FROM formats WHERE id = ?').run(id);
    audit(ws.db, { userId: actor.id, action: 'format.delete', entity: 'format', entityId: id, details: { name: cur.name, moved: used } });
  });
}

/** @param {Workspace} ws @param {string} platformId @param {string[]} ids */
export function reorderFormats(ws, platformId, ids) {
  if (!ws.db.prepare('SELECT 1 FROM platforms WHERE id = ?').get(platformId)) throw notFound();
  reorder(ws, 'SELECT id FROM formats WHERE platform_id = ? ORDER BY position', 'UPDATE formats SET position = ? WHERE id = ?', ids, [platformId]);
}

// ---- Favicons --------------------------------------------------------------

/**
 * Fetch the favicon for a platform's domain once and store it as media, so
 * pages never call a third party. Runs in the background; failures leave
 * the coloured initial.
 * @param {App} app @param {Workspace} ws @param {string} id
 */
export function refreshFavicon(app, ws, id) {
  if (app.config.isTest && !app.fetchFavicon) return;
  const p = /** @type {any} */ (ws.db.prepare('SELECT id, slug, domain FROM platforms WHERE id = ?').get(id));
  if (!p?.domain) return;
  const get = app.fetchFavicon ?? defaultFetchFavicon;
  Promise.resolve()
    .then(() => get(p.domain))
    .then(async (data) => {
      if (!data || !data.length || data.length > 256 * 1024) return;
      const m = await ingestBuffer(app, ws, { userId: null, data, filename: `${p.slug}-favicon.png`, skipCap: true });
      ws.db.prepare('UPDATE platforms SET favicon_media_id = ? WHERE id = ? AND domain = ?').run(m.id, p.id, p.domain);
    })
    .catch((err) => app.log?.warn?.({ err: String(err), domain: p.domain }, 'favicon fetch failed'));
}

/** @param {string} domain */
async function defaultFetchFavicon(domain) {
  const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

// ---- Posts -----------------------------------------------------------------

const POST_SELECT = `
  SELECT p.*, pl.name AS platform_name, pl.slug AS platform_slug, pl.color AS platform_color, pl.enabled AS platform_enabled,
    pl.icon_media_id, pl.favicon_media_id,
    f.name AS format_name, f.media_kind, f.ratio_w, f.ratio_h,
    e.title AS event_title, e.type AS event_type
  FROM posts p
  JOIN platforms pl ON pl.id = p.platform_id
  JOIN formats f ON f.id = p.format_id
  LEFT JOIN entries e ON e.id = p.event_id`;

/** @param {Workspace} ws @param {string[]} ids */
function loadMedia(ws, ids) {
  /** @type {Map<string, any[]>} */ const out = new Map();
  if (!ids.length) return out;
  const rows = /** @type {any[]} */ (
    ws.db.prepare(`SELECT pm.*, m.id AS m_id FROM post_media pm LEFT JOIN media m ON m.id = pm.media_id
      WHERE pm.post_id IN (SELECT value FROM json_each(?)) ORDER BY pm.post_id, pm.position`).all(JSON.stringify(ids))
  );
  const media = new Map();
  for (const r of rows) {
    if (r.media_id && !media.has(r.media_id)) {
      const m = getMedia(ws, r.media_id);
      media.set(r.media_id, m ? mediaView(m) : null);
    }
    const list = out.get(r.post_id) ?? [];
    list.push(r.media_id ? { media_id: r.media_id, media: media.get(r.media_id) } : { url: r.external_url, kind: kindOfUrl(r.external_url) });
    out.set(r.post_id, list);
  }
  return out;
}

/** @param {any} r @param {any[]} media */
function postView(r, media) {
  return {
    id: r.id,
    platform_id: r.platform_id,
    format_id: r.format_id,
    publish_date: r.publish_date,
    publish_time: r.publish_time,
    title: r.title,
    caption: r.caption,
    status: r.status,
    share_link: r.share_link,
    event_id: r.event_id,
    event: r.event_id ? { id: r.event_id, title: r.event_title, type: r.event_type } : null,
    platform: { id: r.platform_id, name: r.platform_name, slug: r.platform_slug, color: r.platform_color, enabled: !!r.platform_enabled, icon_url: iconUrl(r) },
    format: { id: r.format_id, name: r.format_name, media_kind: r.media_kind, ratio: `${r.ratio_w}:${r.ratio_h}` },
    media,
    version: r.version,
    created_at: r.created_at,
    created_by: r.created_by,
    updated_at: r.updated_at,
    updated_by: r.updated_by,
  };
}

/** @param {string} s */
const fold = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Posts in a date range, filtered. The search matches title, caption,
 * platform name and format name, ignoring case and diacritics.
 * @param {Workspace} ws @param {{from?: string, to?: string, platform?: string, status?: string, q?: string, event?: string}} f
 */
export function listPosts(ws, f) {
  const where = [];
  /** @type {Record<string, any>} */ const args = {};
  if (f.from) (where.push('p.publish_date >= :from'), (args.from = f.from));
  if (f.to) (where.push('p.publish_date <= :to'), (args.to = f.to));
  if (f.platform) (where.push('p.platform_id = :platform'), (args.platform = f.platform));
  if (f.status) (where.push('p.status = :status'), (args.status = f.status));
  if (f.event) (where.push('p.event_id = :event'), (args.event = f.event));
  let rows = /** @type {any[]} */ (
    ws.db.prepare(`${POST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.publish_date, p.publish_time, p.title LIMIT 5000`).all(args)
  );
  const q = fold(f.q?.trim() ?? '');
  if (q) rows = rows.filter((r) => fold(`${r.title} ${r.caption} ${r.platform_name} ${r.format_name}`).includes(q));
  const media = loadMedia(ws, rows.map((r) => r.id));
  return rows.map((r) => postView(r, media.get(r.id) ?? []));
}

/** @param {Workspace} ws @param {string} id */
export function getPost(ws, id) {
  const r = /** @type {any} */ (ws.db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(id));
  if (!r) throw notFound();
  return postView(r, loadMedia(ws, [id]).get(id) ?? []);
}

/**
 * Validate references, the past-date rule and, for scheduled posts, the
 * media and caption against the format.
 * @param {Workspace} ws @param {any} input @param {any} [prev]
 */
function validatePost(ws, input, prev) {
  const platform = /** @type {any} */ (ws.db.prepare('SELECT * FROM platforms WHERE id = ?').get(input.platform_id));
  if (!platform) throw badRequest('validation_error', { fields: { platform_id: 'not_found' } });
  if (!platform.enabled && prev?.platform_id !== platform.id) throw badRequest('validation_error', { fields: { platform_id: 'platform_disabled' } });
  const format = /** @type {any} */ (ws.db.prepare('SELECT * FROM formats WHERE id = ? AND platform_id = ?').get(input.format_id, platform.id));
  if (!format) throw badRequest('validation_error', { fields: { format_id: 'not_found' } });
  if (input.event_id) {
    const e = /** @type {any} */ (ws.db.prepare('SELECT type FROM entries WHERE id = ?').get(input.event_id));
    if (!e || (e.type !== 'event' && prev?.event_id !== input.event_id)) throw badRequest('validation_error', { fields: { event_id: 'invalid_event' } });
  }
  const infos = input.media.map((/** @type {any} */ m, /** @type {number} */ i) => {
    if (m.url) return { kind: kindOfUrl(m.url) };
    const row = getMedia(ws, m.media_id);
    if (!row) throw badRequest('validation_error', { fields: { [`media.${i}`]: 'not_found' } });
    return { kind: row.mime.startsWith('video/') ? 'video' : 'image', width: row.width, height: row.height, duration_s: row.duration_s, bytes: row.bytes };
  });

  // Past-date rule (§6.3): new posts can't be scheduled in the past; moving
  // a post into the past is allowed only when it is published.
  const past = isPastMoment(input.publish_date, input.publish_time, ws.tz());
  const moved = !prev || prev.publish_date !== input.publish_date || prev.publish_time !== input.publish_time;
  if (past && moved && input.status !== 'published') {
    throw badRequest('validation_error', { fields: { publish_date: 'post_in_past' } }, 'Only published posts can be dated in the past');
  }

  if (input.status === 'scheduled') {
    const blockers = scheduleBlockers(format, infos, input.caption ?? '');
    if (blockers.length) throw new ApiError(422, 'post_not_ready', 'Fix the media and caption, or save as draft', { blockers });
  }
}

/** @param {Workspace} ws @param {string} postId @param {any[]} media */
function writeMedia(ws, postId, media) {
  ws.db.prepare('DELETE FROM post_media WHERE post_id = ?').run(postId);
  const st = ws.db.prepare('INSERT INTO post_media (post_id, position, media_id, external_url) VALUES (?, ?, ?, ?)');
  media.forEach((m, i) => st.run(postId, i, m.media_id ?? null, m.media_id ? null : m.url));
}

/**
 * Keep events' promotion status in step with their posts: an event with a
 * linked post is promoted; one whose last post went returns to pending.
 * @param {Workspace} ws @param {(string|null|undefined)[]} eventIds
 */
export function syncPromotion(ws, eventIds) {
  for (const id of new Set(eventIds.filter(Boolean))) {
    const e = /** @type {any} */ (ws.db.prepare('SELECT type, promotion_status FROM entries WHERE id = ?').get(id));
    if (!e || e.type !== 'event') continue;
    const n = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE event_id = ?').get(id)).n;
    const next = n ? 'promoted' : e.promotion_status === 'promoted' ? 'pending' : e.promotion_status;
    if (next !== e.promotion_status) ws.db.prepare('UPDATE entries SET promotion_status = ? WHERE id = ?').run(next, id);
  }
}

/** @param {Workspace} ws @param {Actor} actor @param {any} input */
export function createPost(ws, actor, input) {
  validatePost(ws, input);
  const id = newId();
  ws.db.tx(() => {
    const now = isoNow();
    insert(ws.db, 'posts', {
      id, platform_id: input.platform_id, format_id: input.format_id, publish_date: input.publish_date, publish_time: input.publish_time,
      title: input.title, caption: input.caption ?? '', status: input.status, share_link: input.share_link ?? null, event_id: input.event_id ?? null,
      created_at: now, created_by: actor.id, updated_at: now, updated_by: actor.id,
    });
    writeMedia(ws, id, input.media);
    syncPromotion(ws, [input.event_id]);
    audit(ws.db, { userId: actor.id, action: 'post.create', entity: 'post', entityId: id, details: { title: input.title, status: input.status } });
  });
  return getPost(ws, id);
}

/** @param {Workspace} ws @param {Actor} actor @param {string} id @param {any} input @param {number} version */
export function updatePost(ws, actor, id, input, version) {
  const prev = /** @type {any} */ (ws.db.prepare('SELECT * FROM posts WHERE id = ?').get(id));
  if (!prev) throw notFound();
  if (prev.version !== version) throw conflict('version_conflict', { current: prev.version });
  const next = { ...prev, media: getPost(ws, id).media.map((/** @type {any} */ m) => (m.media_id ? { media_id: m.media_id } : { url: m.url })), ...input };
  validatePost(ws, next, prev);
  ws.db.tx(() => {
    const res = ws.db
      .prepare(`UPDATE posts SET platform_id = :platform_id, format_id = :format_id, publish_date = :publish_date, publish_time = :publish_time,
        title = :title, caption = :caption, status = :status, share_link = :share_link, event_id = :event_id,
        version = version + 1, updated_at = :now, updated_by = :actor WHERE id = :id AND version = :version`)
      .run({
        platform_id: next.platform_id, format_id: next.format_id, publish_date: next.publish_date, publish_time: next.publish_time,
        title: next.title, caption: next.caption ?? '', status: next.status, share_link: next.share_link ?? null, event_id: next.event_id ?? null,
        now: isoNow(), actor: actor.id, id, version,
      });
    if (!res.changes) throw conflict('version_conflict');
    if ('media' in input) writeMedia(ws, id, next.media);
    syncPromotion(ws, [prev.event_id, next.event_id]);
    audit(ws.db, { userId: actor.id, action: 'post.update', entity: 'post', entityId: id, details: Object.keys(input) });
  });
  return getPost(ws, id);
}

/** @param {Workspace} ws @param {Actor} actor @param {string} id @param {number} version */
export function deletePost(ws, actor, id, version) {
  const prev = /** @type {any} */ (ws.db.prepare('SELECT * FROM posts WHERE id = ?').get(id));
  if (!prev) throw notFound();
  if (prev.version !== version) throw conflict('version_conflict', { current: prev.version });
  ws.db.tx(() => {
    ws.db.prepare('DELETE FROM posts WHERE id = ?').run(id);
    syncPromotion(ws, [prev.event_id]);
    audit(ws.db, { userId: actor.id, action: 'post.delete', entity: 'post', entityId: id, details: { title: prev.title } });
  });
}

// ---- Export / import -------------------------------------------------------

/**
 * One JSON document with platforms, formats and posts.
 * @param {Workspace} ws @param {{promotions?: boolean}} [opts]
 */
export function exportSocial(ws, opts = {}) {
  const platforms = listPlatforms(ws);
  const posts = listPosts(ws, {});
  const fmtName = new Map(platforms.flatMap((p) => p.formats.map((/** @type {any} */ f) => [f.id, f.name])));
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: isoNow(),
    platforms: platforms.map((p) => ({
      id: p.id, slug: p.slug, name: p.name, color: p.color, domain: p.domain, description: p.description, enabled: p.enabled,
      formats: p.formats.map((/** @type {any} */ f) => ({ id: f.id, ...Object.fromEntries(FORMAT_COLS.map((c) => [c, f[c]])) })),
    })),
    posts: posts.map((p) => ({
      id: p.id, platform: p.platform.slug, format: fmtName.get(p.format_id), publish_date: p.publish_date, publish_time: p.publish_time,
      title: p.title, caption: p.caption, status: p.status, share_link: p.share_link,
      media: p.media.map((/** @type {any} */ m) => (m.media_id ? { media_id: m.media_id } : { url: m.url })),
      ...(opts.promotions ? { event_id: p.event_id } : {}),
    })),
  };
}

class DryRun extends Error {}

/**
 * Import an export document. Platforms and formats are synced to the file
 * (matched by slug and by format name); posts are matched by id and, when
 * the file has a `posts` list, posts missing from it are removed. The whole
 * import is one transaction. A dry run applies it, records the diff and
 * rolls back, so the preview is exactly what the real import will do.
 * @param {Workspace} ws @param {Actor} actor @param {import('zod').infer<typeof import('../../shared/schemas/social.js').SocialExport>} doc @param {boolean} dryRun
 */
export function importSocial(ws, actor, doc, dryRun) {
  const diff = {
    platforms: { added: /** @type {string[]} */ ([]), updated: /** @type {string[]} */ ([]), removed: /** @type {string[]} */ ([]), kept: /** @type {string[]} */ ([]) },
    formats: { added: 0, updated: 0, removed: 0, kept: 0 },
    posts: { added: 0, updated: 0, removed: 0, unchanged: 0 },
    warnings: /** @type {{code: string, params?: any}[]}*/ ([]),
  };
  const slugs = new Set();
  for (const p of doc.platforms) {
    if (slugs.has(p.slug)) throw badRequest('validation_error', { fields: { platforms: 'duplicate_slug' } }, `Duplicate platform ${p.slug}`);
    slugs.add(p.slug);
    const names = new Set();
    for (const f of p.formats) {
      if (names.has(f.name)) throw badRequest('validation_error', { fields: { formats: 'duplicate_format' } }, `Duplicate format ${f.name}`);
      names.add(f.name);
    }
  }
  const fileHasPosts = Array.isArray(doc.posts);
  const now = isoNow();
  try {
    ws.db.tx(() => {
      const affectedEvents = /** @type {string[]} */ ([]);
      // Posts first, so platforms and formats that end up unused can go.
      if (fileHasPosts) {
        const keep = new Set(doc.posts?.map((p) => p.id).filter(Boolean));
        for (const r of /** @type {any[]} */ (ws.db.prepare('SELECT id, event_id FROM posts').all())) {
          if (!keep.has(r.id)) {
            ws.db.prepare('DELETE FROM posts WHERE id = ?').run(r.id);
            affectedEvents.push(r.event_id);
            diff.posts.removed++;
          }
        }
      }
      /** @type {Map<string, {id: string, formats: Map<string, string>}>} */
      const ids = new Map();
      const current = new Map(/** @type {any[]} */ (ws.db.prepare('SELECT * FROM platforms').all()).map((p) => [p.slug, p]));
      doc.platforms.forEach((p, i) => {
        const row = { name: p.name, color: p.color, domain: p.domain ?? null, description: p.description ?? null, enabled: p.enabled ? 1 : 0, position: i };
        let cur = current.get(p.slug);
        current.delete(p.slug);
        if (!cur) {
          cur = { id: newId() };
          insert(ws.db, 'platforms', { id: cur.id, slug: p.slug, ...row, created_at: now, created_by: actor.id, updated_at: now, updated_by: actor.id });
          diff.platforms.added.push(p.name);
        } else {
          const changed = Object.entries(row).some(([k, v]) => k !== 'position' && cur[k] !== v);
          ws.db.prepare(`UPDATE platforms SET name = :name, color = :color, domain = :domain, description = :description, enabled = :enabled,
            position = :position${changed ? ', version = version + 1, updated_at = :now, updated_by = :actor' : ''} WHERE id = :id`)
            .run({ ...row, ...(changed ? { now, actor: actor.id } : {}), id: cur.id });
          if (changed) diff.platforms.updated.push(p.name);
        }
        const fmap = new Map();
        const existing = new Map(/** @type {any[]} */ (ws.db.prepare('SELECT * FROM formats WHERE platform_id = ?').all(cur.id)).map((f) => [f.name, f]));
        let formatChanged = false;
        p.formats.forEach((f, j) => {
          const frow = pick(f, FORMAT_COLS);
          const ef = existing.get(f.name);
          existing.delete(f.name);
          if (!ef) {
            fmap.set(f.name, insertFormat(ws, actor, cur.id, frow, j));
            diff.formats.added++;
            formatChanged = true;
          } else {
            const changed = FORMAT_COLS.some((c) => (ef[c] ?? null) !== (frow[c] ?? null));
            ws.db.prepare(`UPDATE formats SET ${FORMAT_COLS.map((c) => `${c} = :${c}`).join(', ')}, position = :position
              ${changed ? ', version = version + 1, updated_at = :now, updated_by = :actor' : ''} WHERE id = :id`)
              .run({ ...Object.fromEntries(FORMAT_COLS.map((c) => [c, frow[c] ?? null])), position: j, ...(changed ? { now, actor: actor.id } : {}), id: ef.id });
            fmap.set(f.name, ef.id);
            if (changed) (diff.formats.updated++, (formatChanged = true));
          }
        });
        for (const ef of existing.values()) {
          if (ws.db.prepare('SELECT 1 FROM posts WHERE format_id = ?').get(ef.id)) {
            diff.formats.kept++;
            diff.warnings.push({ code: 'format_kept', params: { platform: p.name, format: ef.name } });
            fmap.set(ef.name, ef.id);
          } else {
            ws.db.prepare('DELETE FROM formats WHERE id = ?').run(ef.id);
            diff.formats.removed++;
            formatChanged = true;
          }
        }
        if (formatChanged && !diff.platforms.added.includes(p.name) && !diff.platforms.updated.includes(p.name)) diff.platforms.updated.push(p.name);
        ids.set(p.slug, { id: cur.id, formats: fmap });
      });
      let pos = doc.platforms.length;
      for (const p of current.values()) {
        if (ws.db.prepare('SELECT 1 FROM posts WHERE platform_id = ?').get(p.id)) {
          ws.db.prepare('UPDATE platforms SET position = ? WHERE id = ?').run(pos++, p.id);
          diff.platforms.kept.push(p.name);
          const fmap = new Map(/** @type {any[]} */ (ws.db.prepare('SELECT id, name FROM formats WHERE platform_id = ?').all(p.id)).map((f) => [f.name, f.id]));
          ids.set(p.slug, { id: p.id, formats: fmap });
        } else {
          ws.db.prepare('DELETE FROM platforms WHERE id = ?').run(p.id);
          diff.platforms.removed.push(p.name);
        }
      }

      for (const [i, p] of (doc.posts ?? []).entries()) {
        const pl = ids.get(p.platform);
        const fid = pl?.formats.get(p.format);
        if (!pl || !fid) throw badRequest('validation_error', { fields: { [`posts.${i}`]: 'unknown_format' } }, `Post ${p.title}: unknown platform or format`);
        const media = p.media.filter((m) => {
          if ('url' in m) return true;
          if (getMedia(ws, m.media_id)) return true;
          diff.warnings.push({ code: 'media_missing', params: { title: p.title } });
          return false;
        });
        const cur = p.id ? /** @type {any} */ (ws.db.prepare('SELECT * FROM posts WHERE id = ?').get(p.id)) : null;
        // A file exported without promotion links keeps the existing links.
        const eventId =
          p.event_id === undefined
            ? cur?.event_id ?? null
            : p.event_id && ws.db.prepare("SELECT 1 FROM entries WHERE id = ? AND type = 'event'").get(p.event_id) ? p.event_id : null;
        const row = {
          platform_id: pl.id, format_id: fid, publish_date: p.publish_date, publish_time: p.publish_time, title: p.title,
          caption: p.caption ?? '', status: p.status, share_link: p.share_link || null, event_id: eventId,
        };
        if (!cur) {
          const id = p.id && /^[0-9a-f-]{36}$/i.test(p.id) ? p.id : newId();
          insert(ws.db, 'posts', { id, ...row, created_at: now, created_by: actor.id, updated_at: now, updated_by: actor.id });
          writeMedia(ws, id, media);
          diff.posts.added++;
        } else {
          const oldMedia = JSON.stringify(/** @type {any[]} */ (ws.db.prepare('SELECT media_id, external_url FROM post_media WHERE post_id = ? ORDER BY position').all(cur.id))
            .map((m) => (m.media_id ? { media_id: m.media_id } : { url: m.external_url })));
          const changed = Object.entries(row).some(([k, v]) => cur[k] !== v) || oldMedia !== JSON.stringify(media);
          if (changed) {
            ws.db.prepare(`UPDATE posts SET ${Object.keys(row).map((k) => `${k} = :${k}`).join(', ')}, version = version + 1, updated_at = :now, updated_by = :actor WHERE id = :id`)
              .run({ ...row, now, actor: actor.id, id: cur.id });
            writeMedia(ws, cur.id, media);
            diff.posts.updated++;
          } else diff.posts.unchanged++;
          affectedEvents.push(cur.event_id);
        }
        affectedEvents.push(eventId);
      }
      syncPromotion(ws, affectedEvents);
      if (dryRun) throw new DryRun();
      audit(ws.db, { userId: actor.id, action: 'social.import', entity: 'social', entityId: null, details: diff });
    });
  } catch (err) {
    if (!(err instanceof DryRun)) throw err;
  }
  return diff;
}
