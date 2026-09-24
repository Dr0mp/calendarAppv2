import { Hono } from 'hono';
import { body, ifMatch, requireAdmin, requireUser, withVersion, wsOf } from '../app.js';
import { RoomInput, SpaceInput, Reorder } from '../../../shared/schemas/venue.js';
import { createVenue, deleteVenue, getVenue, listVenues, reorderVenues, updateVenue } from '../../db/repos/venues.js';
import { todayIn } from '../../../shared/rules/time.js';

/** @type {Hono<import('../app.js').Env>} */
export const venueRoutes = new Hono();

for (const [table, schema] of /** @type {const} */ ([
  ['spaces', SpaceInput],
  ['rooms', RoomInput],
])) {
  venueRoutes.get(`/${table}`, (c) => {
    requireUser(c);
    const ws = wsOf(c);
    return c.json({ items: listVenues(ws.db, table, todayIn(ws.tz())), nextCursor: null });
  });

  venueRoutes.get(`/${table}/:id`, (c) => {
    requireUser(c);
    return withVersion(c, getVenue(wsOf(c).db, table, c.req.param('id')));
  });

  venueRoutes.post(`/${table}/reorder`, async (c) => {
    requireAdmin(c);
    const { ids } = await body(c, Reorder);
    reorderVenues(wsOf(c).db, table, ids);
    const ws = wsOf(c);
    return c.json({ items: listVenues(ws.db, table, todayIn(ws.tz())) });
  });

  venueRoutes.post(`/${table}`, async (c) => {
    const u = requireAdmin(c);
    const data = await body(c, schema);
    return withVersion(c, createVenue(wsOf(c).db, table, data, u.id), 201);
  });

  venueRoutes.patch(`/${table}/:id`, async (c) => {
    const u = requireAdmin(c);
    const data = await body(c, schema.partial());
    return withVersion(c, updateVenue(wsOf(c).db, table, c.req.param('id'), data, ifMatch(c), u.id));
  });

  venueRoutes.delete(`/${table}/:id`, (c) => {
    requireAdmin(c);
    deleteVenue(wsOf(c).db, table, c.req.param('id'), ifMatch(c));
    return c.json({ ok: true });
  });
}
