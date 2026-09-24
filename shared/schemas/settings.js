import { z } from 'zod';
import { locale, text } from './common.js';

export const SettingsPatch = z.strictObject({
  org_name: text(80).optional(),
  tz: z.string().min(1).max(64).optional(),
  default_locale: locale.optional(),
  /** Storage cap in bytes; must not exceed the environment's STORAGE_CAP_GB. */
  storage_cap_bytes: z.number().int().positive().optional(),
  promo_template: z.string().max(4000, 'too_long').optional(),
});
