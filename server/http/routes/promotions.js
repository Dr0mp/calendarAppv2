import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, wsOf } from '../app.js';
import { parse } from '../errors.js';
import { FILTERS, listPromotions, promotionDraft, setSkipped } from '../../services/promotions.js';

/** @type {Hono<import('../app.js').Env>} */
export const promotionRoutes = new Hono();

const Query = z.object({ filter: z.enum(FILTERS).default('pending') });

promotionRoutes.get('/promotions', (c) => {
  requireAdmin(c);
  const { filter } = parse(Query, c.req.query());
  return c.json({ filter, ...listPromotions(wsOf(c), filter) });
});

promotionRoutes.get('/promotions/:entryId/draft', (c) => {
  requireAdmin(c);
  return c.json(promotionDraft(wsOf(c), c.req.param('entryId')));
});

promotionRoutes.post('/promotions/:entryId/skip', (c) => {
  const u = requireAdmin(c);
  return c.json(setSkipped(wsOf(c), u, c.req.param('entryId'), true));
});

promotionRoutes.delete('/promotions/:entryId/skip', (c) => {
  const u = requireAdmin(c);
  return c.json(setSkipped(wsOf(c), u, c.req.param('entryId'), false));
});
