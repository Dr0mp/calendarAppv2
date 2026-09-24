import { newId } from '../util.js';
import { ApiError, conflict, forbidden, notFound } from '../http/errors.js';
import { normaliseEntry, entrySpan } from '../../shared/schemas/entry.js';
import { findRoomConflicts, findSpaceConflicts, sameDayOthers, busyOn } from '../../shared/rules/conflicts.js';
import { suggestAlternatives } from '../../shared/rules/availability.js';
import { canDeleteEntry, canEditEntry, canSeePrivate, isAdmin, isEntryPast, isStaff } from '../../shared/rules/permissions.js';
import { addDays, isPastSlot, todayIn } from '../../shared/rules/time.js';
import * as repo from '../db/repos/entries.js';
import { initialsOf, loadUser } from './users.js';

/**
 * @typedef {import('../app.js').Workspace} Workspace
 * @typedef {import('../app.js').App} App
 * @typedef {{id: string, role: 'user'|'moderator'|'admin', name: string}} Actor
 */

/**
 * The API shape of an entry, redacted for readers who are neither staff nor
 * the owner: private notes of blocked slots, guest names and counts, and
 * room-only titles are removed.
 * @param {any} e hydrated row @param {Actor} viewer @param {string} tz
 */
export function entryView(e, viewer, tz) {
  const priv = canSeePrivate(e, viewer);
  const former = !e.owner_name;
  return {
    id: e.id,
    type: e.type,
    title: e.type === 'room_only' && !priv ? null : e.title,
    description: e.type === 'blocked' && !priv ? null : e.description,
    owner: {
      id: e.owner_id,
      name: e.owner_name ?? e.owner_name_snapshot,
      color: e.owner_color ?? 'owner-7',
      initials: e.owner_initials || initialsOf(e.owner_name ?? e.owner_name_snapshot),
      former,
    },
    space_id: e.space_id,
    space: e.space_id ? { id: e.space_id, name: e.space_name, capacity_people: e.space_capacity, color: e.space_color } : null,
    sessions: e.sessions,
    room_bookings: e.room_bookings.map((/** @type {any} */ b) =>
      priv ? b : { id: b.id, room_id: b.room_id, room_name: b.room_name, check_in: b.check_in, check_out: b.check_out },
    ),
    price_cents: e.price_cents,
    currency: e.currency,
    price_note: e.price_note,
    enroll_url: e.enroll_url,
    cover_media_id: e.cover_media_id,
    cover_url: e.cover_url,
    promotion_status: isAdmin(viewer) ? e.promotion_status : undefined,
    series_id: e.series_id,
    occurrence_index: e.occurrence_index,
    series_total: e.series_id ? e.series_total : null,
    allow_overlap: !!e.allow_overlap,
    first_date: e.first_date,
    last_date: e.last_date,
    version: e.version,
    created_at: e.created_at,
    updated_at: e.updated_at,
    updated_by: e.updated_by,
    redacted: !priv && (e.type === 'room_only' || e.type === 'blocked' || e.room_bookings.length > 0),
    past: isEntryPast(e, tz),
    can_edit: canEditEntry(e, viewer, tz),
    can_delete: canDeleteEntry(e, viewer),
  };
}

/** Text the viewer may search in (never redacted fields). @param {ReturnType<typeof entryView>} v */
function haystack(v) {
  return [
    v.title,
    v.description,
    v.space?.name,
    v.owner.name,
    ...v.room_bookings.map((/** @type {any} */ b) => `${b.room_name ?? ''} ${b.guest_names ?? ''}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('ro');
}

/** Case- and diacritic-insensitive match. @param {string} s */
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * @param {Workspace} ws @param {Actor} viewer
 * @param {{from?: string, to?: string, type?: string[], space?: string[], owner?: string, q?: string}} f
 */
export function listEntries(ws, viewer, f) {
  const tz = ws.tz();
  let rows;
  if (f.owner && !f.from) rows = repo.loadByOwner(ws.db, f.owner === 'me' ? viewer.id : f.owner);
  else rows = repo.loadRange(ws.db, /** @type {string} */ (f.from), /** @type {string} */ (f.to));
  let items = rows.map((e) => entryView(e, viewer, tz));
  if (f.type?.length) items = items.filter((e) => f.type?.includes(e.type));
  if (f.space?.length) items = items.filter((e) => e.space_id && f.space?.includes(e.space_id));
  if (f.owner) {
    const owner = f.owner === 'me' ? viewer.id : f.owner;
    items = items.filter((e) => e.owner.id === owner);
  }
  if (f.q?.trim()) {
    const q = fold(f.q.trim());
    items = items.filter((e) => fold(haystack(e)).includes(q));
  }
  return items;
}

/** @param {Workspace} ws @param {string} id */
export function getEntryOr404(ws, id) {
  const e = repo.loadEntry(ws.db, id);
  if (!e) throw notFound('entry_not_found');
  return e;
}

/**
 * Check space and room conflicts inside the current transaction.
 * @param {Workspace} ws
 * @param {{id?: string, type: string, space_id: string|null, sessions: any[], room_bookings?: any[]}} candidate
 * @param {{actor: Actor, allowOverlap: boolean, checkRooms: boolean}} opts
 */
export function assertNoConflicts(ws, candidate, opts) {
  const bookings = candidate.room_bookings ?? [];
  const dates = candidate.sessions.map((s) => s.date);
  const roomFrom = bookings.length ? bookings.map((b) => b.check_in).sort()[0] : null;
  const roomTo = bookings.length ? bookings.map((b) => b.check_out).sort().at(-1) : null;
  const existing = repo
    .loadConflictCandidates(ws.db, dates, bookings.map((b) => b.room_id), roomFrom, roomTo ?? null)
    .map(asRuleEntry);
  if (opts.checkRooms) {
    const rooms = findRoomConflicts(bookings, existing, candidate.id);
    if (rooms.length) {
      throw conflict('room_conflict', { conflicts: rooms.map(describeRoomConflict) }, 'Room booking overlaps');
    }
  }
  const space = findSpaceConflicts(/** @type {any} */ (candidate), existing);
  if (space.length) {
    if (opts.allowOverlap && isAdmin(opts.actor)) return { overridden: space };
    throw conflict('space_conflict', { conflicts: space.map(describeSpaceConflict), canOverride: isAdmin(opts.actor) }, 'Space is busy');
  }
  return { overridden: [] };
}

/** @param {any} e */
function asRuleEntry(e) {
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    space_id: e.space_id,
    owner_id: e.owner_id,
    owner_name: e.owner_name ?? e.owner_name_snapshot,
    sessions: e.sessions,
    room_bookings: e.room_bookings,
  };
}

/** @param {import('../../shared/rules/conflicts.js').SpaceConflict} c */
function describeSpaceConflict(c) {
  return { id: c.entry.id, title: c.entry.type === 'room_only' ? null : c.entry.title, type: c.entry.type, owner: c.entry.owner_name, date: c.date, start: c.start, end: c.end, kind: c.kind, session: c.session };
}

/** @param {import('../../shared/rules/conflicts.js').RoomConflict} c */
function describeRoomConflict(c) {
  return { id: c.entry.id, title: c.entry.title, owner: c.entry.owner_name, room_id: c.room_id, check_in: c.check_in, check_out: c.check_out, booking: c.booking };
}

/** Validate references (space enabled, rooms exist, media exists). @param {Workspace} ws @param {any} e @param {any} [prev] */
function assertReferences(ws, e, prev) {
  if (e.space_id) {
    const s = /** @type {any} */ (ws.db.prepare('SELECT enabled FROM spaces WHERE id = ?').get(e.space_id));
    if (!s) throw new ApiError(400, 'validation_error', 'Unknown space', { fields: { space_id: 'invalid_value' } });
    if (!s.enabled && prev?.space_id !== e.space_id) throw new ApiError(400, 'validation_error', 'Space disabled', { fields: { space_id: 'space_disabled' } });
  }
  for (const [i, b] of (e.room_bookings ?? []).entries()) {
    const r = /** @type {any} */ (ws.db.prepare('SELECT enabled FROM rooms WHERE id = ?').get(b.room_id));
    const had = prev?.room_bookings?.some((/** @type {any} */ x) => x.room_id === b.room_id);
    if (!r || (!r.enabled && !had)) throw new ApiError(400, 'validation_error', 'Unknown room', { fields: { [`room_bookings.${i}.room_id`]: 'invalid_value' } });
  }
  if (e.cover_media_id) {
    const m = /** @type {any} */ (ws.db.prepare('SELECT width, height, mime FROM media WHERE id = ?').get(e.cover_media_id));
    if (!m) throw new ApiError(400, 'validation_error', 'Unknown media', { fields: { cover: 'invalid_value' } });
    const ratio = m.width && m.height ? m.width / m.height : 0;
    if (!m.mime.startsWith('image/') || ratio < 1.7 || ratio > 1.85) {
      throw new ApiError(400, 'validation_error', 'Cover must be 16:9', { fields: { cover: 'cover_not_16_9' } });
    }
  }
}

/**
 * Create one entry (recurrence is handled by the series service).
 * @param {App} app @param {Workspace} ws @param {Actor} actor @param {any} input parsed EntryInput
 * @param {{seriesId?: string|null, occurrenceIndex?: number|null, skipPastCheck?: boolean}} [extra]
 */
export function createEntry(app, ws, actor, input, extra = {}) {
  const e = normaliseEntry(input);
  const tz = ws.tz();
  if (e.type === 'room_only' && !isStaff(actor)) throw forbidden('rooms_staff_only');
  if (e.room_bookings?.length && !isStaff(actor)) throw forbidden('rooms_staff_only');
  if (!extra.skipPastCheck) assertNotPast(e, tz);
  const id = newId();
  return ws.db.tx(() => {
    assertReferences(ws, e);
    const { overridden } = assertNoConflicts(ws, { ...e, id }, { actor, allowOverlap: e.allow_overlap, checkRooms: true });
    const { first, last } = entrySpan({ sessions: e.sessions, room_bookings: e.room_bookings });
    repo.insertEntryRow(
      ws.db,
      {
        ...e,
        id,
        owner_id: actor.id,
        owner_name_snapshot: actor.name,
        promotion_status: e.type === 'event' ? 'pending' : null,
        series_id: extra.seriesId ?? null,
        occurrence_index: extra.occurrenceIndex ?? null,
        allow_overlap: overridden.length > 0,
        first_date: first,
        last_date: last,
      },
      actor.id,
    );
    repo.writeChildren(ws.db, id, e.sessions, e.room_bookings ?? [], tz);
    if (overridden.length) {
      repo.audit(ws.db, { userId: actor.id, action: 'allow_overlap', entity: 'entry', entityId: id, details: overridden.map((c) => c.entry.id) });
    }
    return repo.loadEntry(ws.db, id);
  });
}

/** New sessions and bookings can't start in the past. @param {any} e @param {string} tz */
function assertNotPast(e, tz) {
  e.sessions.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
    if (isPastSlot(s.date, s.start, tz)) throw new ApiError(400, 'validation_error', 'Session in the past', { fields: { [`sessions.${i}.start`]: 'in_the_past' } });
  });
  const today = todayIn(tz);
  (e.room_bookings ?? []).forEach((/** @type {any} */ b, /** @type {number} */ i) => {
    if (b.check_in < today) throw new ApiError(400, 'validation_error', 'Check-in in the past', { fields: { [`room_bookings.${i}.check_in`]: 'in_the_past' } });
  });
}

/**
 * Update one entry. Owners edit their own (not past); admins edit any.
 * Non-staff can't change room bookings; omitted bookings are kept.
 * @param {App} app @param {Workspace} ws @param {Actor} actor @param {string} id @param {any} input @param {number} version
 */
export function updateEntry(app, ws, actor, id, input, version) {
  const tz = ws.tz();
  return ws.db.tx(() => {
    const cur = getEntryOr404(ws, id);
    if (cur.version !== version) throw conflict('version_conflict', { current: cur.version });
    if (!canEditEntry(cur, actor, tz)) throw forbidden(isEntryPast(cur, tz) ? 'past_entry_admin_only' : 'forbidden');
    const e = normaliseEntry(input);
    if (!isStaff(actor)) {
      if (e.type === 'room_only') throw forbidden('rooms_staff_only');
      if (e.room_bookings !== undefined && !sameBookings(e.room_bookings, cur.room_bookings)) throw forbidden('rooms_staff_only');
      e.room_bookings = undefined;
    }
    // Sessions moved into the past are refused (unless an admin edits a past entry).
    if (!isAdmin(actor)) {
      const before = new Set(cur.sessions.map((/** @type {any} */ s) => `${s.date} ${s.start} ${s.end}`));
      e.sessions.forEach((s, i) => {
        if (!before.has(`${s.date} ${s.start} ${s.end}`) && isPastSlot(s.date, s.start, tz)) {
          throw new ApiError(400, 'validation_error', 'Session in the past', { fields: { [`sessions.${i}.start`]: 'in_the_past' } });
        }
      });
    }
    assertReferences(ws, e, cur);
    const bookings = e.room_bookings ?? cur.room_bookings;
    const { overridden } = assertNoConflicts(ws, { ...e, id, room_bookings: bookings }, {
      actor,
      allowOverlap: e.allow_overlap,
      checkRooms: e.room_bookings !== undefined,
    });
    const { first, last } = entrySpan({ sessions: e.sessions, room_bookings: bookings });
    const hasPosts = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE event_id = ?').get(id)).n > 0;
    let promotion = cur.promotion_status;
    if (e.type !== 'event') promotion = null;
    else if (cur.type !== 'event' || !promotion) promotion = hasPosts ? 'promoted' : 'pending';
    const ok = repo.updateEntryRow(
      ws.db,
      id,
      { ...e, promotion_status: promotion, allow_overlap: overridden.length > 0 || (cur.allow_overlap && e.allow_overlap), first_date: first, last_date: last },
      version,
      actor.id,
    );
    if (!ok) throw conflict('version_conflict', { current: getEntryOr404(ws, id).version });
    repo.writeChildren(ws.db, id, e.sessions, e.room_bookings, tz);
    if (overridden.length) {
      repo.audit(ws.db, { userId: actor.id, action: 'allow_overlap', entity: 'entry', entityId: id, details: overridden.map((c) => c.entry.id) });
    }
    return repo.loadEntry(ws.db, id);
  });
}

/** @param {any[]} a @param {any[]} b */
function sameBookings(a, b) {
  const key = (/** @type {any} */ x) => `${x.room_id}|${x.check_in}|${x.check_out}|${x.guests ?? 1}|${x.guest_names ?? ''}`;
  return a.map(key).sort().join('\n') === b.map(key).sort().join('\n');
}

/**
 * Staff replace the room bookings of any entry (moderators manage accommodation).
 * @param {App} app @param {Workspace} ws @param {Actor} actor @param {string} id @param {any[]} bookings @param {number} version
 */
export function replaceRoomBookings(app, ws, actor, id, bookings, version) {
  if (!isStaff(actor)) throw forbidden('rooms_staff_only');
  const tz = ws.tz();
  return ws.db.tx(() => {
    const cur = getEntryOr404(ws, id);
    if (cur.version !== version) throw conflict('version_conflict', { current: cur.version });
    if (cur.type === 'room_only' && !bookings.length) throw new ApiError(400, 'validation_error', 'Room booking required', { fields: { room_bookings: 'room_booking_required' } });
    bookings.forEach((b, i) => {
      if (b.check_out <= b.check_in) throw new ApiError(400, 'validation_error', 'Bad range', { fields: { [`room_bookings.${i}.check_out`]: 'checkout_before_checkin' } });
    });
    assertReferences(ws, { room_bookings: bookings }, cur);
    assertNoConflicts(ws, { id, type: 'room_only', space_id: null, sessions: [], room_bookings: bookings }, { actor, allowOverlap: false, checkRooms: true });
    const { first, last } = entrySpan({ sessions: cur.sessions, room_bookings: bookings });
    repo.updateEntryRow(ws.db, id, { first_date: first, last_date: last }, version, actor.id);
    repo.writeChildren(ws.db, id, cur.sessions, bookings, tz);
    return repo.loadEntry(ws.db, id);
  });
}

/** @param {App} app @param {Workspace} ws @param {Actor} actor @param {string} id @param {number} version */
export function deleteEntry(app, ws, actor, id, version) {
  ws.db.tx(() => {
    const cur = getEntryOr404(ws, id);
    if (cur.version !== version) throw conflict('version_conflict', { current: cur.version });
    if (!canDeleteEntry(cur, actor)) throw forbidden();
    repo.deleteEntryRow(ws.db, id);
  });
}

/** @param {App} app @param {Workspace} ws @param {Actor} actor @param {string} id @param {string} ownerId @param {string[]} [ids] */
export function reassignEntries(app, ws, actor, id, ownerId, ids) {
  if (!isAdmin(actor)) throw forbidden();
  const owner = loadUser(app.authDb, ownerId);
  const inDemo = owner && (owner.is_demo || owner.is_seed);
  if (!owner || owner.status === 'disabled' || (ws.name === 'demo') !== !!inDemo) {
    throw new ApiError(400, 'validation_error', 'Unknown owner', { fields: { ownerId: 'invalid_value' } });
  }
  return ws.db.tx(() => {
    getEntryOr404(ws, id);
    for (const eid of ids ?? [id]) {
      repo.updateEntryRow(ws.db, eid, { owner_id: owner.id, owner_name_snapshot: owner.name }, null, actor.id);
    }
    return repo.loadEntry(ws.db, id);
  });
}

/**
 * Live availability for the scheduling form: conflicts, suggestions, the calm
 * same-day note, and busy intervals for the strip.
 * @param {Workspace} ws @param {Actor} viewer @param {any} input parsed AvailabilityInput
 */
export function availability(ws, viewer, input) {
  const tz = ws.tz();
  const probe = { id: input.excludeEntryId ?? undefined, type: input.type, space_id: input.spaceId ?? null };
  const rooms = input.rooms ?? [];
  const suggestionDates = input.sessions.flatMap((/** @type {any} */ s) => Array.from({ length: 31 }, (_, i) => addDays(s.date, i)));
  const stripDates = [...new Set([...input.sessions.map((/** @type {any} */ s) => s.date), ...(input.dates ?? [])])];
  const roomFrom = rooms.length ? rooms.map((/** @type {any} */ b) => b.check_in).sort()[0] : null;
  const roomTo = rooms.length ? rooms.map((/** @type {any} */ b) => b.check_out).sort().at(-1) : null;
  const existing = repo
    .loadConflictCandidates(ws.db, [...stripDates, ...suggestionDates], rooms.map((/** @type {any} */ b) => b.room_id), roomFrom, roomTo ?? null)
    .map(asRuleEntry);
  const candidate = { ...probe, sessions: input.sessions, room_bookings: rooms };
  const conflicts = input.type === 'room_only' ? [] : findSpaceConflicts(/** @type {any} */ (candidate), existing);
  const roomConflicts = findRoomConflicts(/** @type {any} */ (rooms), existing, probe.id);
  const isPast = (/** @type {string} */ d, /** @type {string} */ t) => isPastSlot(d, t, tz);

  // Suggestions for each conflicting session.
  const conflicting = [...new Set(conflicts.map((c) => `${c.session.date}|${c.session.start}|${c.session.end}`))];
  const suggestions = conflicting.map((key) => {
    const [date, start, end] = key.split('|');
    const others = input.sessions.filter((/** @type {any} */ s) => !(s.date === date && s.start === start && s.end === end));
    const isFree = (/** @type {any} */ s) =>
      !findSpaceConflicts(/** @type {any} */ ({ ...probe, sessions: [s] }), existing).length &&
      !others.some((/** @type {any} */ o) => o.date === s.date && o.start < s.end && s.start < o.end);
    return { session: { date, start, end }, options: suggestAlternatives({ date, start, end }, { isFree, isPast }) };
  });

  // Redact titles the viewer may not see.
  const redact = (/** @type {any} */ o) => ({
    id: o.id,
    type: o.type,
    title: o.type === 'room_only' && !canSeePrivate(o, viewer) ? null : o.title,
    owner: o.owner_name,
    space_id: o.space_id,
  });
  const busy = Object.fromEntries(
    stripDates.map((d) => [d, busyOn(d, probe, existing).map((b) => ({ start: b.start, end: b.end, entry: redact(b.entry) }))]),
  );
  const sameDay = Object.fromEntries(
    input.sessions.map((/** @type {any} */ s) => [s.date, sameDayOthers(/** @type {any} */ (candidate), s.date, existing).map(redact)]),
  );
  return {
    conflicts: conflicts.map((c) => ({ ...describeSpaceConflict(c), title: redact(c.entry).title })),
    roomConflicts: roomConflicts.map((c) => ({ ...describeRoomConflict(c), title: c.entry.id ? redact({ ...c.entry, owner_id: null }).title : null })),
    suggestions,
    sameDayOther: sameDay,
    busy,
  };
}
