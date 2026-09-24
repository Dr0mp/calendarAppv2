/** Workspace settings (key/value). @typedef {import('../db/open.js').Db} Db */

export const DEFAULT_PROMO_TEMPLATE = [
  '🚀 {title}',
  'Susținut de {owner}',
  '📅 {date}, {time} · {space}',
  '🎟️ {price}',
  '🔗 Înscrieri: {enroll_url}',
  '',
  '{description}',
].join('\n');

export const DEFAULTS = {
  tz: 'Europe/Bucharest',
  org_name: 'Casa Artis',
  default_locale: 'ro',
  storage_cap_bytes: '',
  promo_template: DEFAULT_PROMO_TEMPLATE,
  last_promo_platform: '',
  seeded_at: '',
};

/** @param {Db} db @param {keyof typeof DEFAULTS} key */
export function getSetting(db, key) {
  const row = /** @type {any} */ (db.prepare('SELECT value FROM settings WHERE key = ?').get(key));
  return row ? row.value : DEFAULTS[key];
}

/** @param {Db} db @param {keyof typeof DEFAULTS} key @param {string} value */
export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** @param {Db} db */
export function allSettings(db) {
  /** @type {Record<string,string>} */ const out = { ...DEFAULTS };
  for (const r of /** @type {any[]} */ (db.prepare('SELECT key, value FROM settings').all())) out[r.key] = r.value;
  return out;
}
