import { Hono } from 'hono';
import { body, ifMatch, requireUser, withVersion, wsOf } from '../app.js';
import { ApiError, forbidden, notFound, parse } from '../errors.js';
import { AvailabilityInput, EntryInput, ReassignInput, RoomBookingsInput, SeriesPreviewInput } from '../../../shared/schemas/entry.js';
import { isValidDate } from '../../../shared/schemas/common.js';
import { diffDays, todayIn } from '../../../shared/rules/time.js';
import * as entries from '../../services/entries.js';
import * as series from '../../services/series.js';
import { z } from 'zod';

/** @type {Hono<import('../app.js').Env>} */
export const entryRoutes = new Hono();

const MAX_RANGE_DAYS = 400;

/** @param {any} c */
function actorOf(c) {
  const u = requireUser(c);
  return { id: u.id, role: u.role, name: u.name };
}

entryRoutes.get('/entries', (c) => {
  const actor = actorOf(c);
  const ws = wsOf(c);
  const q = c.req.query();
  const multi = (/** @type {string} */ k) => c.req.queries(k)?.flatMap((v) => v.split(',')).filter(Boolean) ?? [];
  const owner = q.owner || undefined;
  if (!owner || q.from || q.to) {
    if (!isValidDate(q.from ?? '') || !isValidDate(q.to ?? '') || q.to < q.from) {
      throw new ApiError(400, 'validation_error', 'from/to required', { fields: { from: 'invalid_date' } });
    }
    if (diffDays(q.from, q.to) > MAX_RANGE_DAYS) throw new ApiError(400, 'range_too_large');
  }
  const items = entries.listEntries(ws, actor, { from: q.from, to: q.to, type: multi('type'), space: multi('space'), owner, q: q.q });
  return c.json({ items, nextCursor: null });
});

entryRoutes.get('/entries/:id', (c) => {
  const actor = actorOf(c);
  const ws = wsOf(c);
  return withVersion(c, entries.entryView(entries.getEntryOr404(ws, c.req.param('id')), actor, ws.tz()));
});

const CreateBody = z.strictObject({ entry: z.record(z.string(), z.unknown()), recurrence: z.unknown().optional() });

entryRoutes.post('/entries', async (c) => {
  const actor = actorOf(c);
  const ws = wsOf(c);
  const app = c.get('app');
  const raw = await body(c, CreateBody);
  // Permission before validation: only staff create room bookings.
  if ((raw.entry.type === 'room_only' || (Array.isArray(raw.entry.room_bookings) && raw.entry.room_bookings.length)) && actor.role === 'user') {
    throw forbidden('rooms_staff_only');
  }
  // Field errors are reported relative to the entry (e.g. `sessions.0.start`).
  const entry = parse(EntryInput, raw.entry);
  const recurrence = raw.recurrence;
  if (recurrence) {
    const created = series.createSeries(app, ws, actor, entry, recurrence);
    return withVersion(c, { ...entries.entryView(created[0], actor, ws.tz()), created: created.length }, 201);
  }
  const e = entries.createEntry(app, ws, actor, entry);
  return withVersion(c, entries.entryView(e, actor, ws.tz()), 201);
});

const Scope = z.enum(['one', 'following', 'all']).default('one');

entryRoutes.patch('/entries/:id', async (c) => {
  const actor = actorOf(c);
  const ws = wsOf(c);
  const app = c.get('app');
  const input = await body(c, EntryInput);
  const scope = Scope.parse(c.req.query('scope') ?? 'one');
  const version = ifMatch(c);
  const e = series.updateScoped(app, ws, actor, c.req.param('id'), input, version, scope);
  return withVersion(c, entries.entryView(e, actor, ws.tz()));
});

entryRoutes.delete('/entries/:id', (c) => {
  const actor = actorOf(c);
  const ws = wsOf(c);
  const app = c.get('app');
  const scope = Scope.parse(c.req.query('scope') ?? 'one');
  const n = series.deleteScoped(app, ws, actor, c.req.param('id'), ifMatch(c), scope);
  return c.json({ ok: true, deleted: n });
});

entryRoutes.post('/entries/:id/reassign', async (c) => {
  const actor = actorOf(c);
  const ws = wsOf(c);
  const app = c.get('app');
  const { ownerId, scope } = await body(c, ReassignInput);
  const ids = series.scopeIds(ws, c.req.param('id'), scope ?? 'one');
  const e = entries.reassignEntries(app, ws, actor, c.req.param('id'), ownerId, ids);
  return withVersion(c, entries.entryView(e, actor, ws.tz()));
});

entryRoutes.put('/entries/:id/room-bookings', async (c) => {
  const actor = actorOf(c);
  const ws = wsOf(c);
  if (actor.role === 'user') throw forbidden('rooms_staff_only');
  const { room_bookings } = await body(c, RoomBookingsInput);
  const e = entries.replaceRoomBookings(c.get('app'), ws, actor, c.req.param('id'), room_bookings, ifMatch(c));
  return withVersion(c, entries.entryView(e, actor, ws.tz()));
});

entryRoutes.post('/availability', async (c) => {
  const actor = actorOf(c);
  const ws = wsOf(c);
  const input = await body(c, AvailabilityInput);
  if (input.rooms?.length && actor.role === 'user') throw forbidden('rooms_staff_only');
  return c.json(entries.availability(ws, actor, input));
});

entryRoutes.get('/me/counts', (c) => {
  const actor = actorOf(c);
  const ws = wsOf(c);
  const today = todayIn(ws.tz());
  const myUpcoming = /** @type {any} */ (ws.db.prepare('SELECT COUNT(*) AS n FROM entries WHERE owner_id = ? AND last_date >= ?').get(actor.id, today)).n;
  let promotions = 0;
  if (actor.role === 'admin') {
    promotions = /** @type {any} */ (
      ws.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE type = 'event' AND promotion_status = 'pending' AND last_date >= ?").get(today)
    ).n;
  }
  return c.json({ myUpcoming, promotions });
});


entryRoutes.post('/series/preview', async (c) => {
  const actor = actorOf(c);
  const ws = wsOf(c);
  const input = await body(c, SeriesPreviewInput);
  if (input.rooms?.length && actor.role === 'user') throw forbidden('rooms_staff_only');
  return c.json(series.previewSeries(ws, actor, input));
});

entryRoutes.get('/series/:id', (c) => {
  actorOf(c);
  const view = series.seriesView(wsOf(c), c.req.param('id'));
  if (!view) throw notFound('series_not_found');
  return c.json(view);
});
