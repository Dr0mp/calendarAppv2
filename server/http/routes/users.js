import { Hono } from 'hono';

/** @type {Hono<import('../app.js').Env>} */
export const userRoutes = new Hono();
