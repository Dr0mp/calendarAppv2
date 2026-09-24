import { Hono } from 'hono';
import { z } from 'zod';
import { body, ifMatch, requireAdmin, withVersion, wsOf } from '../app.js';
import { parse } from '../errors.js';
import { Reorder } from '../../../shared/schemas/venue.js';
import { DeleteFormatInput, DeletePlatformInput, FormatFields, FormatInput, PlatformInput, PostInput, SocialExport } from '../../../shared/schemas/social.js';
import * as social from '../../services/social.js';
import { importSeedMedia } from '../../services/media.js';

/** @type {Hono<import('../app.js').Env>} */
export const socialRoutes = new Hono();

/** Optional JSON body (DELETE with options). @param {import('hono').Context<any>} c @param {import('zod').ZodType} schema */
async function optBody(c, schema) {
  const raw = await c.req.text();
  if (!raw.trim()) return parse(schema, {});
  try {
    return parse(schema, JSON.parse(raw));
  } catch (err) {
    if (err instanceof SyntaxError) return parse(schema, null);
    throw err;
  }
}

/**
 * A PATCH body: validated with the partial schema, keeping only the keys the
 * client sent (Zod 4 applies defaults and transforms inside optional fields).
 * @template T @param {import('hono').Context<any>} c @param {import('zod').ZodType<T>} schema @returns {Promise<Partial<T>>}
 */
async function patchBody(c, schema) {
  const raw = await body(c, z.record(z.string(), z.unknown()));
  const parsed = /** @type {Record<string, any>} */ (parse(schema, raw));
  return /** @type {any} */ (Object.fromEntries(Object.entries(parsed).filter(([k]) => k in raw)));
}

// ---- Platforms and formats ------------------------------------------------

socialRoutes.get('/platforms', (c) => {
  requireAdmin(c);
  return c.json({ items: social.listPlatforms(wsOf(c)), nextCursor: null });
});

socialRoutes.post('/platforms/reorder', async (c) => {
  requireAdmin(c);
  const { ids } = await body(c, Reorder);
  social.reorderPlatforms(wsOf(c), ids);
  return c.json({ items: social.listPlatforms(wsOf(c)) });
});

socialRoutes.post('/platforms/reset', async (c) => {
  const u = requireAdmin(c);
  const ws = wsOf(c);
  social.resetPlatforms(c.get('app'), ws, u);
  await importSeedMedia(c.get('app'), ws);
  return c.json({ items: social.listPlatforms(ws) });
});

socialRoutes.post('/platforms', async (c) => {
  const u = requireAdmin(c);
  const data = await body(c, PlatformInput);
  return withVersion(c, social.createPlatform(c.get('app'), wsOf(c), u, data), 201);
});

socialRoutes.get('/platforms/:id', (c) => {
  requireAdmin(c);
  return withVersion(c, social.getPlatform(wsOf(c), c.req.param('id')));
});

socialRoutes.patch('/platforms/:id', async (c) => {
  const u = requireAdmin(c);
  const data = await patchBody(c, PlatformInput.partial());
  return withVersion(c, social.updatePlatform(c.get('app'), wsOf(c), u, c.req.param('id'), data, ifMatch(c)));
});

socialRoutes.delete('/platforms/:id', async (c) => {
  const u = requireAdmin(c);
  const opts = await optBody(c, DeletePlatformInput);
  social.deletePlatform(wsOf(c), u, c.req.param('id'), ifMatch(c), opts);
  return c.json({ ok: true });
});

socialRoutes.post('/platforms/:id/formats/reorder', async (c) => {
  requireAdmin(c);
  const { ids } = await body(c, Reorder);
  social.reorderFormats(wsOf(c), c.req.param('id'), ids);
  return c.json(social.getPlatform(wsOf(c), c.req.param('id')));
});

socialRoutes.post('/platforms/:id/formats', async (c) => {
  const u = requireAdmin(c);
  const data = await body(c, FormatInput);
  return withVersion(c, social.createFormat(wsOf(c), u, c.req.param('id'), data), 201);
});

socialRoutes.patch('/platforms/:id/formats/:fid', async (c) => {
  const u = requireAdmin(c);
  const data = await patchBody(c, FormatFields.partial());
  return withVersion(c, social.updateFormat(wsOf(c), u, c.req.param('id'), c.req.param('fid'), data, ifMatch(c)));
});

socialRoutes.delete('/platforms/:id/formats/:fid', async (c) => {
  const u = requireAdmin(c);
  const opts = await optBody(c, DeleteFormatInput);
  social.deleteFormat(wsOf(c), u, c.req.param('id'), c.req.param('fid'), ifMatch(c), opts);
  return c.json({ ok: true });
});

// ---- Posts -----------------------------------------------------------------

const PostQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  platform: z.string().optional(),
  status: z.enum(['draft', 'scheduled', 'published']).optional(),
  q: z.string().max(200).optional(),
  event: z.string().optional(),
});

socialRoutes.get('/posts', (c) => {
  requireAdmin(c);
  const f = parse(PostQuery, c.req.query());
  return c.json({ items: social.listPosts(wsOf(c), f), nextCursor: null });
});

socialRoutes.post('/posts', async (c) => {
  const u = requireAdmin(c);
  const data = await body(c, PostInput);
  return withVersion(c, social.createPost(wsOf(c), u, data), 201);
});

socialRoutes.get('/posts/:id', (c) => {
  requireAdmin(c);
  return withVersion(c, social.getPost(wsOf(c), c.req.param('id')));
});

socialRoutes.patch('/posts/:id', async (c) => {
  const u = requireAdmin(c);
  const data = await patchBody(c, PostInput.partial());
  return withVersion(c, social.updatePost(wsOf(c), u, c.req.param('id'), data, ifMatch(c)));
});

socialRoutes.delete('/posts/:id', (c) => {
  const u = requireAdmin(c);
  social.deletePost(wsOf(c), u, c.req.param('id'), ifMatch(c));
  return c.json({ ok: true });
});

// ---- Export / import -------------------------------------------------------

socialRoutes.get('/social/export', (c) => {
  requireAdmin(c);
  const doc = social.exportSocial(wsOf(c), { promotions: c.req.query('promotions') === '1' });
  c.header('Content-Disposition', `attachment; filename="social-${doc.exportedAt.slice(0, 10)}.json"`);
  return c.json(doc);
});

socialRoutes.post('/social/import', async (c) => {
  const u = requireAdmin(c);
  const doc = await body(c, SocialExport);
  const dryRun = c.req.query('dryRun') === '1';
  return c.json({ dryRun, diff: social.importSocial(wsOf(c), u, doc, dryRun) });
});
