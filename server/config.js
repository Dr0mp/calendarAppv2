import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['0', '1', 'true', 'false'])
  .transform((v) => v === '1' || v === 'true');

const int = (def, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: int(3000, 0, 65535),
  APP_URL: z.url({ protocol: /^https?$/ }),
  APP_ORIGINS: z.string().default(''),
  DATA_DIR: z.string().default('./data'),
  BACKUP_DIR: z.string().optional(),
  SESSION_TTL_DAYS: int(14, 1, 365),
  SESSION_IDLE_HOURS: int(72, 1, 24 * 365),
  STORAGE_CAP_GB: z.coerce.number().positive().default(8),
  MAX_UPLOAD_MB: int(100, 1, 10_000),
  ENABLE_DEMO_ACCOUNTS: bool.default(true),
  DEMO_STORAGE_CAP_MB: int(200, 1),
  DEMO_RESET_HOUR: int(3, 0, 23),
  SEED_SAMPLE_CONTENT: bool.default(true),
  SMTP_URL: z.string().default(''),
  MAIL_FROM: z.string().default(''),
  ADMIN_BOOTSTRAP_USERNAME: z.string().regex(/^[a-z0-9._-]{3,32}$/).default('admin'),
  ADMIN_BOOTSTRAP_EMAIL: z.string().default(''),
  TRUST_PROXY: bool.default(false),
  ASSETS: z.enum(['cdn', 'local']).default('cdn'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HIBP_CHECK: bool.default(true),
  /** Optional built-in HTTPS (HTTP/2) when no reverse proxy terminates TLS. Both or neither. */
  TLS_CERT_FILE: z.string().optional(),
  TLS_KEY_FILE: z.string().optional(),
  TEST_RESET_TOKEN: z.string().default(''),
  /** Tests only: the calendar clock starts at this instant (ISO) and advances in real time. */
  TEST_NOW: z.string().default(''),
});

/**
 * @typedef {ReturnType<typeof loadConfig>} Config
 */

/**
 * Validate process.env (or an override object) and derive the runtime config.
 * @param {Record<string, string | undefined>} env
 */
export function loadConfig(env = process.env) {
  // Treat empty strings as "unset" so defaults apply.
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  // On Render the public URL is provided; use it when APP_URL is not set.
  if (!clean.APP_URL && clean.RENDER_EXTERNAL_URL) clean.APP_URL = clean.RENDER_EXTERNAL_URL;
  const parsed = EnvSchema.safeParse(clean);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    const err = new Error(`Invalid configuration:\n${lines.join('\n')}`);
    err.name = 'ConfigError';
    throw err;
  }
  const c = parsed.data;
  const appUrl = new URL(c.APP_URL);
  const origins = new Set([appUrl.origin]);
  for (const o of c.APP_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      origins.add(new URL(o).origin);
    } catch {
      throw new Error(`Invalid configuration:\n  APP_ORIGINS: "${o}" is not a URL`);
    }
  }
  if (!!c.TLS_CERT_FILE !== !!c.TLS_KEY_FILE) {
    throw new Error('Invalid configuration:\n  TLS_CERT_FILE and TLS_KEY_FILE must be set together.');
  }
  for (const f of [c.TLS_CERT_FILE, c.TLS_KEY_FILE]) {
    if (f && !fs.existsSync(f)) throw new Error(`Invalid configuration:\n  TLS file not found: ${f}`);
  }
  const dataDir = path.resolve(c.DATA_DIR);
  return {
    env: c.NODE_ENV,
    isProd: c.NODE_ENV === 'production',
    isTest: c.NODE_ENV === 'test',
    port: c.PORT,
    appUrl: appUrl.origin,
    origins: [...origins],
    rpId: appUrl.hostname,
    secureCookies: appUrl.protocol === 'https:',
    dataDir,
    backupDir: path.resolve(c.BACKUP_DIR || path.join(dataDir, 'backups')),
    sessionTtlDays: c.SESSION_TTL_DAYS,
    sessionIdleHours: c.SESSION_IDLE_HOURS,
    storageCapBytes: Math.round(c.STORAGE_CAP_GB * 1024 ** 3),
    maxUploadBytes: c.MAX_UPLOAD_MB * 1024 * 1024,
    demoEnabled: c.ENABLE_DEMO_ACCOUNTS,
    demoStorageCapBytes: c.DEMO_STORAGE_CAP_MB * 1024 * 1024,
    demoResetHour: c.DEMO_RESET_HOUR,
    seedSampleContent: c.SEED_SAMPLE_CONTENT,
    smtpUrl: c.SMTP_URL,
    mailFrom: c.MAIL_FROM,
    bootstrapUsername: c.ADMIN_BOOTSTRAP_USERNAME,
    bootstrapEmail: c.ADMIN_BOOTSTRAP_EMAIL,
    trustProxy: c.TRUST_PROXY,
    assets: c.ASSETS,
    logLevel: c.LOG_LEVEL,
    hibpCheck: c.HIBP_CHECK,
    tls: c.TLS_CERT_FILE && c.TLS_KEY_FILE ? { cert: c.TLS_CERT_FILE, key: c.TLS_KEY_FILE } : null,
    testResetToken: c.TEST_RESET_TOKEN,
    testNow: c.NODE_ENV === 'test' && c.TEST_NOW ? Date.parse(c.TEST_NOW) : null,
    version: '2.0.0',
  };
}
