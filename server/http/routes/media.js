import { Hono } from 'hono';

/** @type {Hono<import('../app.js').Env>} */
export const mediaRoutes = new Hono();

/** @type {Hono<import('../app.js').Env>} */
export const mediaFileRoute = new Hono();
