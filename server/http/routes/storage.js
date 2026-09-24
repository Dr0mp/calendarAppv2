import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { body, requireAdmin, wsOf } from '../app.js';
import { forbidden, parse } from '../errors.js';
import { CLEANUP_TOOLS, runCleanup, storageReport } from '../../services/storage.js';
import { backupZip } from '../../services/backup.js';

/** @type {Hono<import('../app.js').Env>} */
export const storageRoutes = new Hono();

storageRoutes.get('/storage', (c) => {
  requireAdmin(c);
  return c.json(storageReport(c.get('app'), wsOf(c)));
});

const CleanupInput = z.strictObject({ olderThanDays: z.number().int().min(0).max(3650).optional() });

storageRoutes.post('/storage/cleanup/:tool', async (c) => {
  const u = requireAdmin(c);
  const tool = parse(z.enum(CLEANUP_TOOLS), c.req.param('tool'));
  const params = await body(c, CleanupInput);
  const dryRun = c.req.query('dryRun') === '1';
  return c.json({ tool, dryRun, ...runCleanup(c.get('app'), wsOf(c), u, tool, params, dryRun) });
});

/** "Descarcă backup": auth.db + main.db snapshots and the main media folder. Never the demo. */
storageRoutes.get('/backup', (c) => {
  const u = requireAdmin(c);
  if (u.is_demo || wsOf(c).name === 'demo') throw forbidden('demo_forbidden');
  const { stream: zip, filename } = backupZip(c.get('app'));
  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  c.header('Cache-Control', 'no-store');
  return stream(c, async (s) => {
    for await (const chunk of /** @type {AsyncIterable<Buffer>} */ (/** @type {unknown} */ (zip))) await s.write(chunk);
  });
});
