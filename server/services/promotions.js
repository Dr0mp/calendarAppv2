// Promotion queue (§6.7): upcoming public events and the posts that promote them.
import { notFound, conflict } from '../http/errors.js';
import { audit } from '../db/repos/entries.js';
import { todayIn, nowIn } from '../../shared/rules/time.js';
import { fillTemplate, promoSlot } from '../../shared/rules/promotion.js';
import { formatForRatio } from '../../shared/rules/media-rules.js';
import { getSetting } from './settings.js';
import { iconUrl, listPlatforms } from './social.js';
import { getMedia, mediaView } from './media.js';

/** @typedef {import('../app.js').Workspace} Workspace */

export const FILTERS = /** @type {const} */ (['pending', 'promoted', 'skipped', 'all']);

/**
 * Upcoming public events (a session today or later), soonest first, with
 * their linked posts and the counts per filter. Blocked slots and room
 * bookings never appear; past events are not counted.
 * @param {Workspace} ws @param {typeof FILTERS[number]} filter
 */
export function listPromotions(ws, filter = 'pending') {
  const tz = ws.tz();
  const now = nowIn(tz);
  const rows = /** @type {any[]} */ (
    ws.db
      .prepare(
        `SELECT e.id, e.title, e.owner_id, e.owner_name_snapshot, u.name AS owner_name, u.color AS owner_color,
           e.space_id, s.name AS space_name, e.price_cents, e.currency, e.price_note, e.cover_media_id, e.cover_url,
           e.promotion_status, e.series_id,
           (SELECT MIN(es.date || ' ' || es.start_time) FROM entry_sessions es WHERE es.entry_id = e.id AND es.date >= :today) AS next_at,
           (SELECT COUNT(*) FROM posts p WHERE p.event_id = e.id) AS post_count
         FROM entries e
         LEFT JOIN auth.users u ON u.id = e.owner_id
         LEFT JOIN spaces s ON s.id = e.space_id
         WHERE e.type = 'event' AND e.last_date >= :today`,
      )
      .all({ today: now.date })
  ).filter((r) => r.next_at);

  const is = {
    pending: (/** @type {any} */ r) => r.promotion_status === 'pending',
    promoted: (/** @type {any} */ r) => r.post_count > 0,
    skipped: (/** @type {any} */ r) => r.promotion_status === 'skipped',
    all: () => true,
  };
  const counts = Object.fromEntries(FILTERS.map((f) => [f, rows.filter(is[f]).length]));
  const items = rows.filter(is[filter]).sort((a, b) => a.next_at.localeCompare(b.next_at));

  const posts = /** @type {any[]} */ (
    items.length
      ? ws.db
          .prepare(
            `SELECT p.id, p.event_id, p.title, p.status, p.publish_date, p.publish_time,
               pl.id AS platform_id, pl.name AS platform_name, pl.color AS platform_color, pl.icon_media_id, pl.favicon_media_id
             FROM posts p JOIN platforms pl ON pl.id = p.platform_id
             WHERE p.event_id IN (SELECT value FROM json_each(?)) ORDER BY p.publish_date, p.publish_time`,
          )
          .all(JSON.stringify(items.map((r) => r.id)))
      : []
  );
  return {
    counts,
    items: items.map((r) => {
      const cover = r.cover_media_id ? getMedia(ws, r.cover_media_id) : null;
      return {
        id: r.id,
        title: r.title,
        owner: { id: r.owner_id, name: r.owner_name ?? r.owner_name_snapshot, color: r.owner_color ?? 'owner-7' },
        space: r.space_id ? { id: r.space_id, name: r.space_name } : null,
        next: { date: r.next_at.slice(0, 10), time: r.next_at.slice(11) },
        price_cents: r.price_cents,
        currency: r.currency,
        price_note: r.price_note,
        cover: cover ? { url: mediaView(cover).url, thumb_url: mediaView(cover).thumb_url } : r.cover_url ? { url: r.cover_url, thumb_url: null } : null,
        promotion_status: r.promotion_status,
        series_id: r.series_id,
        posts: posts
          .filter((p) => p.event_id === r.id)
          .map((p) => ({
            id: p.id, title: p.title, status: p.status, publish_date: p.publish_date, publish_time: p.publish_time,
            platform: { id: p.platform_id, name: p.platform_name, color: p.platform_color, icon_url: iconUrl(p) },
          })),
      };
    }),
  };
}

/** @param {Workspace} ws @param {string} id */
function eventRow(ws, id) {
  const e = /** @type {any} */ (ws.db.prepare('SELECT * FROM entries WHERE id = ?').get(id));
  if (!e || e.type !== 'event') throw notFound();
  return e;
}

/**
 * "Ignoră" / "Anulează ignorarea".
 * @param {Workspace} ws @param {{id: string}} actor @param {string} id @param {boolean} skip
 */
export function setSkipped(ws, actor, id, skip) {
  const e = eventRow(ws, id);
  if (skip && e.promotion_status === 'promoted') throw conflict('already_promoted');
  const n = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE event_id = ?').get(id)).n;
  const next = skip ? 'skipped' : n ? 'promoted' : 'pending';
  ws.db.tx(() => {
    ws.db.prepare('UPDATE entries SET promotion_status = ? WHERE id = ?').run(next, id);
    audit(ws.db, { userId: actor.id, action: skip ? 'promotion.skip' : 'promotion.unskip', entity: 'entry', entityId: id });
  });
  return { id, promotion_status: next };
}

const LOCALES = { ro: 'ro-RO', en: 'en-GB' };
const FREE = { ro: 'Gratuit', en: 'Free' };
const TITLE = { ro: 'Promovare: {title}', en: 'Promotion: {title}' };

/**
 * The post editor's prefill for promoting an event: platform (last used,
 * else Facebook, else the first enabled one), the first 16:9 format, the
 * default date, title, caption from the template, the cover and the link.
 * @param {Workspace} ws @param {string} id
 */
export function promotionDraft(ws, id) {
  const e = eventRow(ws, id);
  const tz = ws.tz();
  const lang = /** @type {'ro'|'en'} */ (getSetting(ws.db, 'default_locale') === 'en' ? 'en' : 'ro');
  const sessions = /** @type {any[]} */ (ws.db.prepare('SELECT date, start_time FROM entry_sessions WHERE entry_id = ? ORDER BY date, start_time').all(id));
  const today = todayIn(tz);
  const next = sessions.find((s) => s.date >= today) ?? sessions[0];
  const owner = /** @type {any} */ (ws.db.prepare('SELECT name FROM auth.users WHERE id = ?').get(e.owner_id))?.name ?? e.owner_name_snapshot;
  const space = e.space_id ? /** @type {any} */ (ws.db.prepare('SELECT name FROM spaces WHERE id = ?').get(e.space_id))?.name : null;

  const enabled = listPlatforms(ws).filter((p) => p.enabled);
  const last = getSetting(ws.db, 'last_promo_platform');
  const platform = enabled.find((p) => p.id === last) ?? enabled.find((p) => p.slug === 'facebook') ?? enabled[0] ?? null;
  const format = platform ? formatForRatio(platform.formats, 16, 9) : null;

  const locale = LOCALES[lang];
  const dateText = next
    ? new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${next.date}T12:00:00Z`))
    : '';
  const price =
    e.price_cents == null
      ? FREE[lang]
      : new Intl.NumberFormat(locale, { style: 'currency', currency: e.currency ?? 'RON', minimumFractionDigits: e.price_cents % 100 ? 2 : 0 }).format(e.price_cents / 100);
  const caption = fillTemplate(getSetting(ws.db, 'promo_template'), {
    title: e.title,
    owner,
    date: dateText,
    time: next?.start_time ?? '',
    space: space ?? '',
    price: e.price_note ? `${price} · ${e.price_note}` : price,
    enroll_url: e.enroll_url ?? '',
    description: e.description ?? '',
  });
  const slot = promoSlot(sessions[0]?.date ?? today, tz);
  const cover = e.cover_media_id ? getMedia(ws, e.cover_media_id) : null;
  return {
    platform_id: platform?.id ?? null,
    format_id: format?.id ?? null,
    publish_date: slot.date,
    publish_time: slot.time,
    title: TITLE[lang].replace('{title}', e.title).slice(0, 200),
    caption,
    status: 'draft',
    media: cover ? [{ media_id: cover.id, media: mediaView(cover) }] : e.cover_url ? [{ url: e.cover_url }] : [],
    event_id: e.id,
    event: { id: e.id, title: e.title, type: e.type },
  };
}
