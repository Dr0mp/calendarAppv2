// SQL for entries, their sessions and room bookings. No business rules here.
import { newId, isoNow } from '../../util.js';
import { localToUtc } from '../../../shared/rules/time.js';

/** @typedef {import('../open.js').Db} Db */

const ENTRY_SELECT = `
  SELECT e.*, u.name AS owner_name, u.color AS owner_color, u.initials AS owner_initials,
         s.name AS space_name, s.capacity_people AS space_capacity, s.color AS space_color,
         (SELECT COUNT(*) FROM entries x WHERE x.series_id = e.series_id AND e.series_id IS NOT NULL) AS series_total
  FROM entries e
  LEFT JOIN auth.users u ON u.id = e.owner_id
  LEFT JOIN spaces s ON s.id = e.space_id`;

/**
 * Attach sessions and room bookings to entry rows.
 * @param {Db} db @param {any[]} rows
 */
function hydrate(db, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const sessions = /** @type {any[]} */ (
    db.prepare(`SELECT entry_id, date, start_time, end_time FROM entry_sessions WHERE entry_id IN (${marks}) ORDER BY date, start_time`).all(...ids)
  );
  const bookings = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT b.*, r.name AS room_name, r.capacity_guests AS room_capacity FROM room_bookings b
         LEFT JOIN rooms r ON r.id = b.room_id WHERE b.entry_id IN (${marks}) ORDER BY b.check_in, r.position`,
      )
      .all(...ids)
  );
  /** @type {Map<string, any>} */ const byId = new Map(rows.map((r) => [r.id, { ...r, sessions: [], room_bookings: [] }]));
  for (const s of sessions) byId.get(s.entry_id).sessions.push({ date: s.date, start: s.start_time, end: s.end_time });
  for (const b of bookings) {
    byId.get(b.entry_id).room_bookings.push({
      id: b.id,
      room_id: b.room_id,
      room_name: b.room_name,
      room_capacity: b.room_capacity,
      check_in: b.check_in,
      check_out: b.check_out,
      guests: b.guests,
      guest_names: b.guest_names,
    });
  }
  return rows.map((r) => byId.get(r.id));
}

/** @param {Db} db @param {string} id */
export function loadEntry(db, id) {
  const row = db.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).get(id);
  return row ? hydrate(db, [row])[0] : null;
}

/** @param {Db} db @param {string[]} ids */
export function loadEntries(db, ids) {
  if (!ids.length) return [];
  const rows = db.prepare(`${ENTRY_SELECT} WHERE e.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  return hydrate(db, rows);
}

/**
 * Entries whose date span overlaps [from, to].
 * @param {Db} db @param {string} from @param {string} to
 */
export function loadRange(db, from, to) {
  const rows = db.prepare(`${ENTRY_SELECT} WHERE e.last_date >= ? AND e.first_date <= ? ORDER BY e.first_date`).all(from, to);
  return hydrate(db, rows);
}

/** @param {Db} db @param {string} ownerId */
export function loadByOwner(db, ownerId) {
  return hydrate(db, db.prepare(`${ENTRY_SELECT} WHERE e.owner_id = ? ORDER BY e.first_date`).all(ownerId));
}

/** @param {Db} db @param {string} seriesId */
export function loadSeries(db, seriesId) {
  return hydrate(db, db.prepare(`${ENTRY_SELECT} WHERE e.series_id = ? ORDER BY e.occurrence_index`).all(seriesId));
}

/**
 * Entries that could conflict with sessions on `dates` or bookings of `rooms`
 * between `roomFrom` and `roomTo`.
 * @param {Db} db @param {string[]} dates @param {string[]} rooms @param {string|null} roomFrom @param {string|null} roomTo
 */
export function loadConflictCandidates(db, dates, rooms, roomFrom, roomTo) {
  /** @type {Set<string>} */ const ids = new Set();
  const uniqDates = [...new Set(dates)];
  for (let i = 0; i < uniqDates.length; i += 400) {
    const chunk = uniqDates.slice(i, i + 400);
    for (const r of /** @type {any[]} */ (db.prepare(`SELECT DISTINCT entry_id FROM entry_sessions WHERE date IN (${chunk.map(() => '?').join(',')})`).all(...chunk))) {
      ids.add(r.entry_id);
    }
  }
  const uniqRooms = [...new Set(rooms)];
  if (uniqRooms.length && roomFrom && roomTo) {
    const rows = /** @type {any[]} */ (
      db
        .prepare(`SELECT DISTINCT entry_id FROM room_bookings WHERE room_id IN (${uniqRooms.map(() => '?').join(',')}) AND check_in < ? AND check_out > ?`)
        .all(...uniqRooms, roomTo, roomFrom)
    );
    for (const r of rows) ids.add(r.entry_id);
  }
  return loadEntries(db, [...ids]);
}

/**
 * Insert or replace the sessions and bookings of an entry.
 * @param {Db} db @param {string} entryId
 * @param {{date: string, start: string, end: string}[]} sessions
 * @param {any[]|undefined} bookings undefined = keep existing bookings
 * @param {string} tz
 */
export function writeChildren(db, entryId, sessions, bookings, tz) {
  db.prepare('DELETE FROM entry_sessions WHERE entry_id = ?').run(entryId);
  const ins = db.prepare('INSERT INTO entry_sessions (id, entry_id, date, start_time, end_time, start_utc, end_utc) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const s of sessions) ins.run(newId(), entryId, s.date, s.start, s.end, localToUtc(s.date, s.start, tz), localToUtc(s.date, s.end, tz));
  if (bookings !== undefined) {
    db.prepare('DELETE FROM room_bookings WHERE entry_id = ?').run(entryId);
    const ib = db.prepare('INSERT INTO room_bookings (id, entry_id, room_id, check_in, check_out, guests, guest_names) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const b of bookings) ib.run(newId(), entryId, b.room_id, b.check_in, b.check_out, b.guests ?? 1, b.guest_names ?? null);
  }
}

const COLS = [
  'type', 'title', 'description', 'owner_id', 'owner_name_snapshot', 'space_id', 'price_cents', 'currency', 'price_note', 'enroll_url',
  'cover_media_id', 'cover_url', 'promotion_status', 'series_id', 'occurrence_index', 'allow_overlap', 'first_date', 'last_date',
];

/** @param {Db} db @param {Record<string, any>} row must include every column in COLS and `id` */
export function insertEntryRow(db, row, actor) {
  const now = isoNow();
  /** @type {Record<string, any>} */
  const data = { ...Object.fromEntries(COLS.map((c) => [c, row[c] ?? null])), id: row.id, created_at: now, created_by: actor, updated_at: now, updated_by: actor };
  data.allow_overlap = row.allow_overlap ? 1 : 0;
  const cols = Object.keys(data);
  db.prepare(`INSERT INTO entries (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`).run(data);
}

/**
 * Update entry columns and bump the version (optimistic concurrency).
 * @param {Db} db @param {string} id @param {Record<string, any>} fields @param {number|null} version null = don't check
 * @returns {boolean} whether a row was updated
 */
export function updateEntryRow(db, id, fields, version, actor) {
  const cols = Object.keys(fields).filter((c) => COLS.includes(c));
  const data = Object.fromEntries(cols.map((c) => [c, c === 'allow_overlap' ? (fields[c] ? 1 : 0) : fields[c]]));
  const sets = [...cols.map((c) => `${c} = :${c}`), 'version = version + 1', 'updated_at = :now', 'updated_by = :actor'].join(', ');
  const where = version === null ? 'id = :id' : 'id = :id AND version = :version';
  const res = db.prepare(`UPDATE entries SET ${sets} WHERE ${where}`).run({ ...data, now: isoNow(), actor, id, ...(version === null ? {} : { version }) });
  return res.changes > 0;
}

/** @param {Db} db @param {string} id */
export function deleteEntryRow(db, id) {
  db.prepare('UPDATE posts SET event_id = NULL WHERE event_id = ?').run(id);
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
}

/** @param {Db} db @param {{userId: string|null, action: string, entity: string, entityId: string|null, details?: any}} a */
export function audit(db, a) {
  db.prepare('INSERT INTO audit_log (id, at, user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    newId(),
    isoNow(),
    a.userId,
    a.action,
    a.entity,
    a.entityId,
    a.details === undefined ? null : JSON.stringify(a.details),
  );
}
