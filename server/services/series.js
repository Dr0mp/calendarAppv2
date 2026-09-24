// Series: create occurrences from a rule, preview them, and apply edits or
// deletes with the scopes "only this", "this and following" and "whole
// series". Every operation is atomic, and past occurrences are never
// changed or deleted by a series operation.
import { newId, isoNow } from '../util.js';
import { ApiError, conflict, forbidden } from '../http/errors.js';
import { entrySpan, normaliseEntry, RecurrenceInput } from '../../shared/schemas/entry.js';
import { occurrences, expandRule, ruleError, shiftBookings, shiftTo } from '../../shared/rules/recurrence.js';
import { canEditEntry, canDeleteEntry, isAdmin, isEntryPast, isStaff } from '../../shared/rules/permissions.js';
import { diffDays, addDays, isPastSlot } from '../../shared/rules/time.js';
import { parse } from '../http/errors.js';
import * as repo from '../db/repos/entries.js';
import * as entries from './entries.js';

/**
 * @typedef {import('../app.js').Workspace} Workspace
 * @typedef {import('../app.js').App} App
 * @typedef {import('./entries.js').Actor} Actor
 */

/** @param {Workspace} ws @param {string} id */
function loadSeriesRow(ws, id) {
  const r = /** @type {any} */ (ws.db.prepare('SELECT * FROM series WHERE id = ?').get(id));
  return r ? { ...r, rule: JSON.parse(r.rule), exceptions: JSON.parse(r.exceptions) } : null;
}

/** @param {Workspace} ws @param {string} id @param {string[]} exceptions */
function saveExceptions(ws, id, exceptions) {
  ws.db.prepare('UPDATE series SET exceptions = ?, version = version + 1, updated_at = ? WHERE id = ?').run(
    JSON.stringify([...new Set(exceptions)].sort()),
    isoNow(),
    id,
  );
}

/** Re-number occurrences and refresh the series span; drop empty series. @param {Workspace} ws @param {string} seriesId */
function reindex(ws, seriesId) {
  const rows = /** @type {any[]} */ (ws.db.prepare('SELECT id, first_date FROM entries WHERE series_id = ? ORDER BY first_date, id').all(seriesId));
  if (!rows.length) {
    ws.db.prepare('DELETE FROM series WHERE id = ?').run(seriesId);
    return;
  }
  const stmt = ws.db.prepare('UPDATE entries SET occurrence_index = ? WHERE id = ?');
  rows.forEach((r, i) => stmt.run(i, r.id));
  ws.db.prepare('UPDATE series SET start_date = ?, end_date = ? WHERE id = ?').run(rows[0].first_date, rows.at(-1).first_date, seriesId);
}

/** The anchor date of an entry (its first session). @param {any} e */
const anchorOf = (e) => (e.sessions[0]?.date ?? e.first_date);

/**
 * Verify every written occurrence against the current state (siblings
 * included) and throw one 409 that lists the conflicting dates.
 * @param {Workspace} ws @param {string[]} ids @param {{actor: Actor, allowOverlap: boolean, checkRooms: boolean}} opts
 */
function verify(ws, ids, opts) {
  /** @type {any[]} */ const space = [];
  /** @type {any[]} */ const rooms = [];
  for (const id of ids) {
    const e = /** @type {any} */ (repo.loadEntry(ws.db, id));
    const found = entries.findConflicts(ws, { id, type: e.type, space_id: e.space_id, sessions: e.sessions, room_bookings: e.room_bookings }, { checkRooms: opts.checkRooms });
    rooms.push(...found.rooms.map((c) => ({ ...entries.describeRoomConflict(c), date: anchorOf(e) })));
    space.push(...found.space.map((c) => ({ ...entries.describeSpaceConflict(c), occurrence: anchorOf(e) })));
  }
  if (rooms.length) throw conflict('room_conflict', { conflicts: rooms, dates: [...new Set(rooms.map((c) => c.date))] }, 'Room booking overlaps');
  if (space.length && !(opts.allowOverlap && isAdmin(opts.actor))) {
    throw conflict('space_conflict', { conflicts: space, dates: [...new Set(space.map((c) => c.occurrence))], canOverride: isAdmin(opts.actor) }, 'Space is busy');
  }
  return space;
}

/**
 * Create a series: one entry per occurrence, with room bookings shifted
 * relative to each occurrence's date. All-or-nothing.
 * @param {App} app @param {Workspace} ws @param {Actor} actor @param {any} input parsed EntryInput @param {unknown} rawRecurrence
 */
export function createSeries(app, ws, actor, input, rawRecurrence) {
  const rec = parse(RecurrenceInput, rawRecurrence);
  const e = normaliseEntry(input);
  const tz = ws.tz();
  if (e.type === 'room_only') throw new ApiError(400, 'validation_error', 'Room bookings do not repeat', { fields: { recurrence: 'invalid_rule' } });
  const anchor = e.sessions[0].date;
  if (e.sessions.some((s) => s.date !== anchor)) {
    throw new ApiError(400, 'validation_error', 'Recurrence needs single-day sessions', { fields: { recurrence: 'recurrence_multiday' } });
  }
  const err = ruleError(rec.rule, anchor);
  if (err) throw new ApiError(400, 'validation_error', 'Invalid rule', { fields: { recurrence: err } });
  if (e.room_bookings?.length && !isStaff(actor)) throw forbidden('rooms_staff_only');
  const dates = occurrences(rec.rule, anchor, rec.exceptions);
  if (!dates.length) throw new ApiError(400, 'validation_error', 'No occurrences', { fields: { recurrence: 'rule_no_dates' } });
  for (const d of dates) entries.assertNotPast({ sessions: shiftTo(e.sessions, anchor, d), room_bookings: [] }, tz);

  return ws.db.tx(() => {
    entries.assertReferences(ws, e);
    const seriesId = newId();
    const now = isoNow();
    ws.db
      .prepare('INSERT INTO series (id, start_date, end_date, rule, exceptions, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(seriesId, dates[0], dates.at(-1), JSON.stringify(rec.rule), JSON.stringify(rec.exceptions), now, actor.id, now, actor.id);
    /** @type {string[]} */ const ids = [];
    dates.forEach((d, i) => {
      const sessions = shiftTo(e.sessions, anchor, d);
      const bookings = shiftBookings(e.room_bookings ?? [], anchor, d);
      const id = newId();
      const { first, last } = entrySpan({ sessions, room_bookings: bookings });
      repo.insertEntryRow(
        ws.db,
        {
          ...e,
          id,
          owner_id: actor.id,
          owner_name_snapshot: actor.name,
          promotion_status: e.type === 'event' ? 'pending' : null,
          series_id: seriesId,
          occurrence_index: i,
          allow_overlap: false,
          first_date: first,
          last_date: last,
        },
        actor.id,
      );
      repo.writeChildren(ws.db, id, sessions, bookings, ws.tz());
      ids.push(id);
    });
    const overridden = verify(ws, ids, { actor, allowOverlap: e.allow_overlap, checkRooms: true });
    if (overridden.length) {
      const hit = new Set(overridden.map((c) => c.occurrence));
      for (const id of ids) {
        const x = /** @type {any} */ (repo.loadEntry(ws.db, id));
        if (hit.has(anchorOf(x))) {
          repo.updateEntryRow(ws.db, id, { allow_overlap: true }, null, actor.id);
          repo.audit(ws.db, { userId: actor.id, action: 'allow_overlap', entity: 'entry', entityId: id, details: overridden.filter((c) => c.occurrence === anchorOf(x)).map((c) => c.id) });
        }
      }
    }
    return repo.loadEntries(ws.db, ids).sort((a, b) => a.occurrence_index - b.occurrence_index);
  });
}

/**
 * Preview a rule: every date (skipped ones included) with a conflict flag.
 * @param {Workspace} ws @param {Actor} viewer @param {any} input parsed SeriesPreviewInput
 */
export function previewSeries(ws, viewer, input) {
  const tz = ws.tz();
  const anchor = input.sessions[0].date;
  const err = ruleError(input.rule, anchor);
  if (err) return { error: err, dates: [] };
  const skipped = new Set(input.exceptions ?? []);
  const all = expandRule(input.rule, anchor);
  const dates = all.map((d) => {
    const sessions = shiftTo(input.sessions, anchor, d);
    const rooms = shiftBookings(input.rooms ?? [], anchor, d);
    const found = entries.findConflicts(ws, { type: input.type, space_id: input.spaceId ?? null, sessions, room_bookings: rooms }, { checkRooms: rooms.length > 0 });
    const past = sessions.some((/** @type {any} */ s) => isPastSlot(s.date, s.start, tz));
    return {
      date: d,
      skipped: skipped.has(d),
      past,
      conflict: found.space.length > 0 || found.rooms.length > 0,
      conflicts: [
        ...found.space.map((c) => ({ title: c.entry.type === 'room_only' && c.entry.owner_id !== viewer.id && !isStaff(viewer) ? null : c.entry.title, owner: c.entry.owner_name, start: c.start, end: c.end })),
        ...found.rooms.map((c) => ({ title: c.entry.title, owner: c.entry.owner_name, room: true })),
      ],
    };
  });
  return { error: null, dates };
}

/**
 * The entries a scope covers: "one" = this entry; "following" = this and
 * later occurrences; "all" = every occurrence. Past occurrences are left
 * out except the entry itself.
 * @param {Workspace} ws @param {string} id @param {'one'|'following'|'all'} scope
 */
export function scopeEntries(ws, id, scope) {
  const cur = entries.getEntryOr404(ws, id);
  if (scope === 'one' || !cur.series_id) return { cur, targets: [cur] };
  const tz = ws.tz();
  const list = repo.loadSeries(ws.db, cur.series_id);
  const from = anchorOf(cur);
  const targets = list.filter((e) => (e.id === cur.id || !isEntryPast(e, tz)) && (scope === 'all' || anchorOf(e) >= from));
  return { cur, targets };
}

/** @param {Workspace} ws @param {string} id @param {'one'|'following'|'all'} scope */
export function scopeIds(ws, id, scope) {
  return scopeEntries(ws, id, scope).targets.map((e) => e.id);
}

/**
 * Split a series so `cur` and every later occurrence move to a new series
 * with the same rule. Earlier occurrences keep the old one.
 * @param {Workspace} ws @param {any} cur @param {Actor} actor
 */
function splitAt(ws, cur, actor) {
  const old = loadSeriesRow(ws, cur.series_id);
  if (!old) return cur.series_id;
  const from = anchorOf(cur);
  const earlier = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND first_date < ?').get(cur.series_id, from)).n;
  if (!earlier) return cur.series_id;
  const id = newId();
  const now = isoNow();
  ws.db
    .prepare('INSERT INTO series (id, start_date, end_date, rule, exceptions, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, from, old.end_date, JSON.stringify(old.rule), JSON.stringify(old.exceptions.filter((/** @type {string} */ d) => d >= from)), now, actor.id, now, actor.id);
  ws.db.prepare('UPDATE entries SET series_id = ? WHERE series_id = ? AND first_date >= ?').run(id, cur.series_id, from);
  saveExceptions(ws, cur.series_id, old.exceptions.filter((/** @type {string} */ d) => d < from));
  reindex(ws, cur.series_id);
  reindex(ws, id);
  return id;
}

/**
 * Update with a scope. The edit is expressed on `cur`; other occurrences get
 * the same fields, with sessions (and room bookings) moved by the same
 * offset relative to their own date.
 * @param {App} app @param {Workspace} ws @param {Actor} actor @param {string} id @param {any} input @param {number} version
 * @param {'one'|'following'|'all'} scope
 */
export function updateScoped(app, ws, actor, id, input, version, scope) {
  const probe = entries.getEntryOr404(ws, id);
  if (!probe.series_id) return entries.updateEntry(app, ws, actor, id, input, version);
  if (scope === 'one') {
    return ws.db.tx(() => {
      const before = entries.getEntryOr404(ws, id);
      const updated = entries.updateEntry(app, ws, actor, id, input, version);
      // Detach it and remember its original date as an exception.
      const s = loadSeriesRow(ws, before.series_id);
      ws.db.prepare('UPDATE entries SET series_id = NULL, occurrence_index = NULL WHERE id = ?').run(id);
      if (s) {
        saveExceptions(ws, s.id, [...s.exceptions, anchorOf(before)]);
        reindex(ws, s.id);
      }
      return repo.loadEntry(ws.db, updated.id);
    });
  }

  const tz = ws.tz();
  return ws.db.tx(() => {
    const { cur, targets } = scopeEntries(ws, id, scope);
    if (cur.version !== version) throw conflict('version_conflict', { current: cur.version });
    const e = normaliseEntry(input);
    if (e.type === 'room_only') throw new ApiError(400, 'validation_error', 'Series are events or blocks', { fields: { type: 'invalid_value' } });
    const newAnchor = e.sessions[0].date;
    if (e.sessions.some((s) => s.date !== newAnchor)) {
      throw new ApiError(400, 'validation_error', 'Series sessions are single-day', { fields: { sessions: 'recurrence_multiday' } });
    }
    const oldAnchor = anchorOf(cur);
    const shift = diffDays(oldAnchor, newAnchor);
    const staff = isStaff(actor);
    if (!staff && e.room_bookings !== undefined && !entries.sameBookings(e.room_bookings, cur.room_bookings)) throw forbidden('rooms_staff_only');
    entries.assertReferences(ws, e, cur);
    if (scope === 'following') splitAt(ws, cur, actor);
    for (const o of targets) {
      if (!canEditEntry(o, actor, tz)) throw forbidden(isEntryPast(o, tz) ? 'past_entry_admin_only' : 'forbidden');
      const date = addDays(anchorOf(o), shift);
      const sessions = shiftTo(e.sessions, newAnchor, date);
      if (!isAdmin(actor) && o.id !== cur.id) sessions.forEach((s) => {
        if (isPastSlot(s.date, s.start, tz)) throw new ApiError(400, 'validation_error', 'Occurrence moved into the past', { fields: { sessions: 'in_the_past' } });
      });
      const bookings = staff && e.room_bookings !== undefined ? shiftBookings(e.room_bookings, newAnchor, date) : undefined;
      const { first, last } = entrySpan({ sessions, room_bookings: bookings ?? o.room_bookings });
      const hasPosts = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE event_id = ?').get(o.id)).n > 0;
      const promotion = e.type !== 'event' ? null : o.type === 'event' && o.promotion_status ? o.promotion_status : hasPosts ? 'promoted' : 'pending';
      repo.updateEntryRow(ws.db, o.id, { ...e, promotion_status: promotion, allow_overlap: false, first_date: first, last_date: last }, null, actor.id);
      repo.writeChildren(ws.db, o.id, sessions, bookings, tz);
    }
    const ids = targets.map((o) => o.id);
    const overridden = verify(ws, ids, { actor, allowOverlap: e.allow_overlap, checkRooms: staff && e.room_bookings !== undefined });
    for (const c of overridden) {
      const target = targets.find((o) => addDays(anchorOf(o), shift) === c.occurrence);
      if (target) {
        repo.updateEntryRow(ws.db, target.id, { allow_overlap: true }, null, actor.id);
        repo.audit(ws.db, { userId: actor.id, action: 'allow_overlap', entity: 'entry', entityId: target.id, details: [c.id] });
      }
    }
    const sid = /** @type {any} */ (repo.loadEntry(ws.db, id)).series_id;
    if (sid) reindex(ws, sid);
    return repo.loadEntry(ws.db, id);
  });
}

/**
 * Delete with a scope. Returns how many entries were deleted.
 * @param {App} app @param {Workspace} ws @param {Actor} actor @param {string} id @param {number} version
 * @param {'one'|'following'|'all'} scope
 */
export function deleteScoped(app, ws, actor, id, version, scope) {
  return ws.db.tx(() => {
    const { cur, targets } = scopeEntries(ws, id, scope);
    if (cur.version !== version) throw conflict('version_conflict', { current: cur.version });
    for (const o of targets) if (!canDeleteEntry(o, actor)) throw forbidden();
    const sid = cur.series_id;
    const s = sid ? loadSeriesRow(ws, sid) : null;
    for (const o of targets) repo.deleteEntryRow(ws.db, o.id);
    if (s) {
      if (scope === 'one') saveExceptions(ws, s.id, [...s.exceptions, anchorOf(cur)]);
      reindex(ws, s.id);
    }
    return targets.length;
  });
}

/**
 * A series and its occurrences (for "see all occurrences").
 * @param {Workspace} ws @param {string} id
 */
export function seriesView(ws, id) {
  const s = loadSeriesRow(ws, id);
  if (!s) return null;
  const tz = ws.tz();
  const list = repo.loadSeries(ws.db, id);
  return {
    id: s.id,
    rule: s.rule,
    exceptions: s.exceptions,
    start_date: s.start_date,
    end_date: s.end_date,
    occurrences: list.map((e) => ({ id: e.id, date: anchorOf(e), start: e.sessions[0]?.start ?? null, index: e.occurrence_index, past: isEntryPast(e, tz) })),
  };
}
