import fs from 'node:fs';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { body, requireUser, wsOf } from '../app.js';
import { ApiError, notFound, tooMany, unauthorized } from '../errors.js';
import { hit } from '../../auth/ratelimit.js';
import { cropMedia, fileOf, getMedia, ingestStream, listMedia, mediaView, usagesOf } from '../../services/media.js';
import { z } from 'zod';

/** @type {Hono<import('../app.js').Env>} */
export const mediaRoutes = new Hono();

const MIN = 60_000;

mediaRoutes.post('/media', async (c) => {
  const user = requireUser(c);
  const app = c.get('app');
  const ws = wsOf(c);
  // Uploads: 60 per 10 min per user in main; 20 per 10 min per IP in the
  // demo, because the demo accounts are shared.
  const key = ws.name === 'demo' ? `upload-ip:${c.get('ip')}` : `upload:${user.id}`;
  const r = hit(app.authDb, key, ws.name === 'demo' ? 20 : 60, 10 * MIN);
  if (!r.ok) throw tooMany(r.retryAfter);
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > app.config.maxUploadBytes) throw new ApiError(413, 'too_large', 'File too large', { maxBytes: app.config.maxUploadBytes });
  let filename = 'upload';
  try {
    filename = decodeURIComponent(c.req.header('x-filename') ?? 'upload').replace(/[\\/\r\n\0]/g, '_');
  } catch {
    /* keep the default */
  }
  const media = await ingestStream(app, ws, { userId: user.id, body: c.req.raw.body, filename });
  return c.json(media, 201);
});

mediaRoutes.get('/media', (c) => {
  const user = requireUser(c);
  const ws = wsOf(c);
  const q = c.req.query();
  const items = listMedia(ws, { kind: q.kind, mine: q.mine ? user.id : null, q: q.q });
  return c.json({ items, nextCursor: null });
});

mediaRoutes.get('/media/sample-cover', (c) => {
  requireUser(c);
  const ws = wsOf(c);
  const row = /** @type {any} */ (ws.db.prepare("SELECT value FROM settings WHERE key = 'sample_cover_media_id'").get());
  if (ws.name !== 'demo' || !row) throw notFound();
  const m = getMedia(ws, row.value);
  if (!m) throw notFound();
  return c.json(mediaView(m));
});

mediaRoutes.get('/media/:id', (c) => {
  requireUser(c);
  const ws = wsOf(c);
  const m = getMedia(ws, c.req.param('id'));
  if (!m) throw notFound();
  return c.json({ ...mediaView(m), usages: usagesOf(ws, m.id) });
});

const CropInput = z.strictObject({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(16),
  h: z.number().int().min(9),
});

mediaRoutes.post('/media/:id/crop', async (c) => {
  const user = requireUser(c);
  const r = await body(c, CropInput);
  const m = await cropMedia(c.get('app'), wsOf(c), user.id, c.req.param('id'), r);
  return c.json(m, 201);
});

/**
 * Files: /media/:id/:variant (original | thumb). Signed-in users of the same
 * workspace only; demo media is visible only to demo sessions.
 * @type {Hono<import('../app.js').Env>}
 */
export const mediaFileRoute = new Hono();

mediaFileRoute.get('/media/:id/:variant', (c) => {
  if (!c.get('user')) throw unauthorized();
  const ws = wsOf(c);
  const variant = c.req.param('variant');
  if (variant !== 'original' && variant !== 'thumb') throw notFound();
  const m = getMedia(ws, c.req.param('id'));
  if (!m) throw notFound();
  const file = fileOf(ws, m, variant);
  if (!file || !fs.existsSync(file)) throw notFound();
  const size = fs.statSync(file).size;
  const etag = `"${m.sha256.slice(0, 16)}-${variant}"`;
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Type', variant === 'thumb' ? 'image/webp' : m.mime);
  c.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(m.original_name ?? 'file')}`);
  c.header('ETag', etag);
  c.header('Accept-Ranges', 'bytes');
  if (c.req.header('if-none-match') === etag) return c.body(null, 304);
  // Byte ranges (video seeking).
  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      c.header('Content-Range', `bytes */${size}`);
      return c.body(null, 416);
    }
    c.status(206);
    c.header('Content-Range', `bytes ${start}-${end}/${size}`);
    c.header('Content-Length', String(end - start + 1));
    return stream(c, async (s) => {
      for await (const chunk of fs.createReadStream(file, { start, end })) await s.write(chunk);
    });
  }
  c.header('Content-Length', String(size));
  return stream(c, async (s) => {
    for await (const chunk of fs.createReadStream(file)) await s.write(chunk);
  });
});
