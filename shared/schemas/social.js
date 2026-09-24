import { z } from "zod";
import {
  dateStr,
  hexColor,
  httpsUrl,
  id,
  optText,
  shareLink,
  text,
  timeStr,
} from "./common.js";

export const MEDIA_KINDS = /** @type {const} */ ([
  "video",
  "image",
  "carousel",
]);
export const POST_STATUSES = /** @type {const} */ ([
  "draft",
  "scheduled",
  "published",
]);

/** A bare domain such as tiktok.com (no scheme, no path). */
export const DOMAIN_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const optInt = (max) =>
  z
    .number()
    .int("invalid_type")
    .min(0, "too_small")
    .max(max, "too_big")
    .nullish()
    .transform((v) => v ?? null);
const posInt = (max) =>
  z.number().int("invalid_type").min(1, "too_small").max(max, "too_big");

export const PlatformInput = z.strictObject({
  name: text(60),
  color: hexColor,
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) =>
      v
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/^www\./, ""),
    )
    .refine((v) => v === "" || DOMAIN_RE.test(v), "invalid_domain")
    .nullish()
    .transform((v) => v || null),
  description: optText(500),
  enabled: z.boolean().default(true),
  icon_media_id: id.nullish(),
});

export const FormatFields = z.strictObject({
  name: text(80),
  media_kind: z.enum(MEDIA_KINDS),
  ratio_w: posInt(100),
  ratio_h: posInt(100),
  width: posInt(10000),
  height: posInt(10000),
  file_formats: optText(200),
  min_duration_s: optInt(86400),
  max_duration_s: optInt(86400),
  max_items: optInt(100),
  max_file_mb: optInt(100000),
  caption_limit: posInt(100000),
  hook_length: optInt(100000),
  safe_zone: optText(500),
  duration_note: optText(200),
  file_size_note: optText(200),
  hook_note: optText(200),
});

export const FormatInput = FormatFields.superRefine((f, ctx) => {
  if (
    f.min_duration_s != null &&
    f.max_duration_s != null &&
    f.min_duration_s > f.max_duration_s
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["max_duration_s"],
      message: "max_below_min",
    });
  }
});

/** Formats every new platform starts with (§6.5). */
export const DEFAULT_FORMATS = [
  {
    name: "Postare imagine (4:5)",
    media_kind: "image",
    ratio_w: 4,
    ratio_h: 5,
    width: 1080,
    height: 1350,
    file_formats: "JPG / PNG",
    caption_limit: 2200,
  },
  {
    name: "Video vertical (9:16)",
    media_kind: "video",
    ratio_w: 9,
    ratio_h: 16,
    width: 1080,
    height: 1920,
    file_formats: "MP4 / MOV",
    caption_limit: 2200,
  },
];

export const PostMediaInput = z.union([
  z.strictObject({ media_id: id }),
  z.strictObject({ url: httpsUrl }),
]);

export const PostInput = z.strictObject({
  platform_id: id,
  format_id: id,
  publish_date: dateStr,
  publish_time: timeStr,
  title: text(200),
  caption: z.string().max(20000, "too_long").default(""),
  status: z.enum(POST_STATUSES),
  media: z.array(PostMediaInput).max(100, "too_big").default([]),
  share_link: z
    .union([shareLink, z.literal(""), z.null()])
    .optional()
    .transform((v) => v || null),
  event_id: id.nullish().transform((v) => v ?? null),
});

export const DeletePlatformInput = z.strictObject({
  mode: z.enum(["move", "delete"]).optional(),
  confirmName: z.string().optional(),
  targetPlatformId: id.optional(),
  /** Source format id → target format id. */
  formatMap: z.record(z.string(), id).optional(),
});

export const DeleteFormatInput = z.strictObject({ moveTo: id.optional() });

// ---- Export / import ---------------------------------------------------

export const EXPORT_SCHEMA_VERSION = 1;

const ExportFormat = z.object({
  id: z.string().optional(),
  name: z.string(),
  media_kind: z.enum(MEDIA_KINDS),
  ratio_w: z.number().int().positive(),
  ratio_h: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  file_formats: z.string().nullish(),
  min_duration_s: z.number().int().nullish(),
  max_duration_s: z.number().int().nullish(),
  max_items: z.number().int().nullish(),
  max_file_mb: z.number().int().nullish(),
  caption_limit: z.number().int().positive(),
  hook_length: z.number().int().nullish(),
  safe_zone: z.string().nullish(),
  duration_note: z.string().nullish(),
  file_size_note: z.string().nullish(),
  hook_note: z.string().nullish(),
});

const ExportPlatform = z.object({
  id: z.string().optional(),
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/, "invalid_slug"),
  name: z.string().min(1).max(60),
  color: hexColor,
  domain: z.string().nullish(),
  description: z.string().nullish(),
  enabled: z.boolean().default(true),
  formats: z.array(ExportFormat).min(1, "format_required"),
});

const ExportPost = z.object({
  id: z.string().optional(),
  platform: z.string(),
  format: z.string(),
  publish_date: dateStr,
  publish_time: timeStr,
  title: z.string().min(1).max(200),
  caption: z.string().max(20000).default(""),
  status: z.enum(POST_STATUSES),
  media: z
    .array(
      z.union([
        z.object({ url: httpsUrl }),
        z.object({ media_id: z.string() }),
      ]),
    )
    .default([]),
  share_link: z.union([shareLink, z.literal(""), z.null()]).optional(),
  event_id: z.string().nullish(),
});

export const SocialExport = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION, "unsupported_schema_version"),
  exportedAt: z.string().optional(),
  platforms: z.array(ExportPlatform).min(1, "platform_required"),
  posts: z.array(ExportPost).optional(),
});
