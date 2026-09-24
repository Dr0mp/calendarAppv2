// Building blocks for the Zod schemas shared by the browser and the server.
// Messages are stable snake_case codes; the client translates them.
import { z } from "zod";
import {
  OWNER_COLORS,
  UNC_RE,
  isHttpsUrl,
  isShareLink,
  isValidDate,
} from "../rules/validate.js";

export { OWNER_COLORS, UNC_RE, isHttpsUrl, isShareLink, isValidDate };

// In the browser the CSP forbids eval: skip Zod's JIT (and its `new Function`
// probe, which the browser reports as a CSP violation even when caught).
if (typeof window !== 'undefined') z.config({ jitless: true });

export const id = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "invalid_id",
  );

export const dateStr = z.string().refine(isValidDate, "invalid_date");
export const timeStr = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "invalid_time");
export const endTimeStr = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, "invalid_time");

export const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(isHttpsUrl, "invalid_https_url");

export const shareLink = z
  .string()
  .trim()
  .max(2000)
  .refine(isShareLink, "invalid_share_link");
export const ownerColor = z.enum(OWNER_COLORS, "invalid_color");
export const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, "invalid_color");
export const locale = z.enum(["ro", "en"]);
export const theme = z.enum(["system", "light", "dark"]);

/** Required trimmed text with a max length. @param {number} max @param {number} [min] */
export const text = (max, min = 1) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? "required" : "too_short")
    .max(max, "too_long");

/** Optional text: empty string becomes null. @param {number} max */
export const optText = (max) =>
  z
    .string()
    .trim()
    .max(max, "too_long")
    .nullish()
    .transform((v) => (v ? v : null));

export const email = z
  .string()
  .trim()
  .max(254, "too_long")
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "invalid_email")
  .transform((v) => v.toLowerCase());
