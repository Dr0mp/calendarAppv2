import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireAdmin, wsOf } from '../app.js';
import { parse } from '../errors.js';
import { auditCsv, auditPage, bulkAction } from '../../services/admin-entries.js';

/** @type {Hono<import('../app.js').Env>} */
export const adminRoutes = new Hono();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');
const AuditQuery = z.object({
  from: date.optional(),
  to: date.optional(),
  type: z.enum(['event', 'blocked', 'room_only']).optional(),
  space: z.string().optional(),
  owner: z.string().optional(),
  promotion: z.enum(['pending', 'promoted', 'skipped']).optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

/** Drop empty query values so "?type=" means "any type". @param {Record<string, string>} q */
const clean = (q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== ''));

adminRoutes.get('/admin/entries', (c) => {
  requireAdmin(c);
  return c.json(auditPage(wsOf(c), parse(AuditQuery, clean(c.req.query()))));
});

adminRoutes.get('/admin/entries.csv', (c) => {
  const u = requireAdmin(c);
  const f = parse(AuditQuery, clean(c.req.query()));
  const lang = u.locale === 'en' ? 'en' : 'ro';
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="inregistrari-${new Date().toISOString().slice(0, 10)}.csv"`);
  return c.body(auditCsv(wsOf(c), f, lang));
});

const BulkInput = z.strictObject({
  action: z.enum(['delete', 'reassign']),
  ids: z.array(z.string()).min(1).max(500),
  ownerId: z.string().optional(),
});

adminRoutes.post('/admin/entries/bulk', async (c) => {
  const u = requireAdmin(c);
  const input = await body(c, BulkInput);
  return c.json(bulkAction(c.get('app'), wsOf(c), u, input));
});
