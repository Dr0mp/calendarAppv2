// "Toate înregistrările" (§7.4): every entry, filtered, paginated, exportable.
import { badRequest } from '../http/errors.js';
import { todayIn } from '../../shared/rules/time.js';
import * as series from './series.js';
import { reassignEntries } from './entries.js';

/** @typedef {import('../app.js').App} App */
/** @typedef {import('../app.js').Workspace} Workspace */

export const PAGE_SIZE = 50;

/** @param {string} s */
const fold = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * @typedef {{from?: string, to?: string, type?: string, space?: string, owner?: string, promotion?: string, q?: string, page?: number}} AuditFilter
 */

/**
 * All entries matching the filters, oldest first. The date range defaults
 * to "from today on"; an entry matches when it overlaps the range.
 * @param {Workspace} ws @param {AuditFilter} f
 */
export function auditRows(ws, f) {
  const where = ['e.last_date >= :from'];
  /** @type {Record<string, any>} */ const args = { from: f.from || todayIn(ws.tz()) };
  if (f.to) (where.push('e.first_date <= :to'), (args.to = f.to));
  if (f.type) (where.push('e.type = :type'), (args.type = f.type));
  if (f.space) (where.push('e.space_id = :space'), (args.space = f.space));
  if (f.owner) (where.push('e.owner_id = :owner'), (args.owner = f.owner));
  if (f.promotion) (where.push("e.type = 'event' AND e.promotion_status = :promotion"), (args.promotion = f.promotion));
  const rows = /** @type {any[]} */ (
    ws.db
      .prepare(
        `SELECT e.id, e.type, e.title, e.description, e.owner_id, e.owner_name_snapshot, u.name AS owner_name, u.color AS owner_color,
           e.space_id, s.name AS space_name, e.price_cents, e.currency, e.price_note, e.promotion_status, e.series_id, e.occurrence_index,
           e.first_date, e.last_date, e.version, e.updated_at, e.updated_by, ub.name AS updated_by_name,
           (SELECT COUNT(*) FROM entries x WHERE x.series_id = e.series_id AND e.series_id IS NOT NULL) AS series_total,
           (SELECT MIN(es.date || ' ' || es.start_time) FROM entry_sessions es WHERE es.entry_id = e.id) AS first_at,
           (SELECT MAX(es.date || ' ' || es.end_time) FROM entry_sessions es WHERE es.entry_id = e.id) AS last_at,
           (SELECT COUNT(*) FROM entry_sessions es WHERE es.entry_id = e.id) AS session_count,
           (SELECT GROUP_CONCAT(r.name, ', ') FROM room_bookings b JOIN rooms r ON r.id = b.room_id WHERE b.entry_id = e.id) AS rooms,
           (SELECT GROUP_CONCAT(COALESCE(b.guest_names, ''), ' ') FROM room_bookings b WHERE b.entry_id = e.id) AS guests,
           (SELECT MIN(b.check_in) FROM room_bookings b WHERE b.entry_id = e.id) AS check_in,
           (SELECT MAX(b.check_out) FROM room_bookings b WHERE b.entry_id = e.id) AS check_out
         FROM entries e
         LEFT JOIN auth.users u ON u.id = e.owner_id
         LEFT JOIN auth.users ub ON ub.id = e.updated_by
         LEFT JOIN spaces s ON s.id = e.space_id
         WHERE ${where.join(' AND ')}
         ORDER BY e.first_date, first_at, e.title`,
      )
      .all(args)
  );
  const q = fold(f.q?.trim() ?? '');
  const hit = q
    ? rows.filter((r) => fold([r.title, r.description, r.owner_name ?? r.owner_name_snapshot, r.space_name, r.rooms, r.guests, r.price_note].join(' ')).includes(q))
    : rows;
  return hit.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    owner: { id: r.owner_id, name: r.owner_name ?? r.owner_name_snapshot, color: r.owner_color ?? 'owner-7', former: !r.owner_name },
    space: r.space_id ? { id: r.space_id, name: r.space_name } : null,
    rooms: r.rooms,
    when:
      r.type === 'room_only'
        ? { check_in: r.check_in, check_out: r.check_out }
        : { date: r.first_at?.slice(0, 10) ?? r.first_date, start: r.first_at?.slice(11) ?? null, end: r.last_at?.slice(11) ?? null, sessions: r.session_count },
    price_cents: r.price_cents,
    currency: r.currency,
    price_note: r.price_note,
    promotion_status: r.type === 'event' ? r.promotion_status : null,
    series_id: r.series_id,
    occurrence_index: r.occurrence_index,
    series_total: r.series_id ? r.series_total : null,
    first_date: r.first_date,
    last_date: r.last_date,
    version: r.version,
    updated_at: r.updated_at,
    updated_by: r.updated_by ? { id: r.updated_by, name: r.updated_by_name ?? '—' } : null,
  }));
}

/** @param {Workspace} ws @param {AuditFilter} f */
export function auditPage(ws, f) {
  const all = auditRows(ws, f);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page ?? 1), pages);
  return { items: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: all.length, page, pages, pageSize: PAGE_SIZE };
}

const HEADERS = {
  ro: ['Dată', 'Oră început', 'Oră sfârșit', 'Sesiuni', 'Titlu', 'Tip', 'Serie', 'Spațiu', 'Camere', 'Sosire', 'Plecare', 'Proprietar', 'Promovare', 'Preț', 'Monedă', 'Notă preț', 'Actualizat la', 'Actualizat de', 'ID'],
  en: ['Date', 'Start', 'End', 'Sessions', 'Title', 'Type', 'Series', 'Space', 'Rooms', 'Check-in', 'Check-out', 'Owner', 'Promotion', 'Price', 'Currency', 'Price note', 'Updated at', 'Updated by', 'ID'],
};
const TYPES = { ro: { event: 'Eveniment public', blocked: 'Interval blocat', room_only: 'Doar cazare' }, en: { event: 'Public event', blocked: 'Blocked slot', room_only: 'Room booking' } };
const PROMO = { ro: { pending: 'De promovat', promoted: 'Promovat', skipped: 'Ignorat' }, en: { pending: 'To promote', promoted: 'Promoted', skipped: 'Skipped' } };

/**
 * One CSV cell: quoted, with formula injection neutralised (a leading
 * = + - @ or control character gets an apostrophe).
 * @param {unknown} v
 */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) || s !== String(v) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * The filtered list as CSV (UTF-8 with BOM so spreadsheets read diacritics).
 * @param {Workspace} ws @param {AuditFilter} f @param {'ro'|'en'} lang
 */
export function auditCsv(ws, f, lang) {
  const rows = auditRows(ws, f);
  const lines = [HEADERS[lang].map(csvCell).join(',')];
  for (const r of rows) {
    const w = /** @type {any} */ (r.when);
    lines.push(
      [
        w.date ?? w.check_in, w.start, w.end, w.sessions, r.title, TYPES[lang][/** @type {'event'} */ (r.type)],
        r.series_id ? `${(r.occurrence_index ?? 0) + 1}/${r.series_total}` : '', r.space?.name, r.rooms, w.check_in, w.check_out,
        r.owner.name, r.promotion_status ? PROMO[lang][/** @type {'pending'} */ (r.promotion_status)] : '',
        r.price_cents == null ? '' : (r.price_cents / 100).toFixed(2), r.currency, r.price_note, r.updated_at, r.updated_by?.name, r.id,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * Bulk actions on selected rows, in one transaction. Delete removes each
 * selected occurrence ("only this" for series); reassign moves them all.
 * @param {App} app @param {Workspace} ws @param {any} actor @param {{action: 'delete'|'reassign', ids: string[], ownerId?: string}} input
 */
export function bulkAction(app, ws, actor, input) {
  const ids = [...new Set(input.ids)];
  return ws.db.tx(() => {
    if (input.action === 'reassign') {
      if (!input.ownerId) throw badRequest('validation_error', { fields: { ownerId: 'required' } });
      reassignEntries(app, ws, actor, ids[0], input.ownerId, ids);
      return { count: ids.length };
    }
    let count = 0;
    for (const id of ids) {
      const row = /** @type {any} */ (ws.db.prepare('SELECT version FROM entries WHERE id = ?').get(id));
      if (!row) continue;
      count += series.deleteScoped(app, ws, actor, id, row.version, 'one');
    }
    return { count };
  });
}
