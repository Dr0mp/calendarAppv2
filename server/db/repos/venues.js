import { newId, isoNow } from '../../util.js';
import { conflict, notFound } from '../../http/errors.js';

/** @typedef {import('../open.js').Db} Db */
/** @typedef {'spaces'|'rooms'} Table */

const COLS = {
  spaces: ['name', 'capacity_people', 'color', 'description', 'enabled'],
  rooms: ['name', 'room_type', 'capacity_guests', 'beds', 'color', 'notes', 'enabled'],
};

/** @param {any} r */
export function venueView(r) {
  return { ...r, enabled: !!r.enabled };
}

/**
 * All spaces or rooms, ordered, with upcoming usage counts.
 * @param {Db} db @param {Table} table @param {string} today
 */
export function listVenues(db, table, today) {
  const count =
    table === 'spaces'
      ? '(SELECT COUNT(*) FROM entries e WHERE e.space_id = v.id AND e.last_date >= :today)'
      : '(SELECT COUNT(*) FROM room_bookings b WHERE b.room_id = v.id AND b.check_out > :today)';
  const rows = db.prepare(`SELECT v.*, ${count} AS upcoming FROM ${table} v ORDER BY v.position, v.name`).all({ today });
  return rows.map(venueView);
}

/** @param {Db} db @param {Table} table @param {string} id */
export function getVenue(db, table, id) {
  const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!r) throw notFound();
  return venueView(r);
}

/** @param {Db} db @param {Table} table @param {Record<string, any>} data @param {string} actor */
export function createVenue(db, table, data, actor) {
  const now = isoNow();
  const pos = /** @type {any} */ (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${table}`).get()).p;
  const row = { id: newId(), ...pick(table, data), position: pos, created_at: now, created_by: actor, updated_at: now, updated_by: actor };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`).run(row);
  return getVenue(db, table, row.id);
}

/** @param {Db} db @param {Table} table @param {string} id @param {Record<string, any>} data @param {number} version @param {string} actor */
export function updateVenue(db, table, id, data, version, actor) {
  const cur = getVenue(db, table, id);
  if (cur.version !== version) throw conflict('version_conflict', { current: cur.version });
  const fields = pick(table, data);
  const sets = Object.keys(fields).map((c) => `${c} = :${c}`).join(', ');
  const res = db
    .prepare(`UPDATE ${table} SET ${sets}, version = version + 1, updated_at = :now, updated_by = :actor WHERE id = :id AND version = :version`)
    .run({ ...fields, now: isoNow(), actor, id, version });
  if (!res.changes) throw conflict('version_conflict', { current: getVenue(db, table, id).version });
  return getVenue(db, table, id);
}

/**
 * Delete a space or room that nothing uses; otherwise 409 in_use
 * ("disable it or move its entries").
 * @param {Db} db @param {Table} table @param {string} id @param {number} version
 */
export function deleteVenue(db, table, id, version) {
  const cur = getVenue(db, table, id);
  if (cur.version !== version) throw conflict('version_conflict', { current: cur.version });
  const used =
    table === 'spaces'
      ? /** @type {any} */ (db.prepare('SELECT COUNT(*) AS n FROM entries WHERE space_id = ?').get(id)).n
      : /** @type {any} */ (db.prepare('SELECT COUNT(*) AS n FROM room_bookings WHERE room_id = ?').get(id)).n;
  if (used) throw conflict('in_use', { count: used });
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

/** @param {Db} db @param {Table} table @param {string[]} ids */
export function reorderVenues(db, table, ids) {
  db.tx(() => {
    const all = /** @type {any[]} */ (db.prepare(`SELECT id FROM ${table} ORDER BY position`).all()).map((r) => r.id);
    const order = [...ids.filter((x) => all.includes(x)), ...all.filter((x) => !ids.includes(x))];
    const stmt = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
    order.forEach((vid, i) => stmt.run(i, vid));
  });
  return listVenues(db, table, '0000-00-00');
}

/** @param {Table} table @param {Record<string, any>} data */
function pick(table, data) {
  /** @type {Record<string, any>} */ const out = {};
  for (const c of COLS[table]) {
    if (data[c] === undefined) continue;
    out[c] = typeof data[c] === 'boolean' ? (data[c] ? 1 : 0) : data[c];
  }
  return out;
}
