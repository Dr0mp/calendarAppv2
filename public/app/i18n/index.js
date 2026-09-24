import { signal } from '@preact/signals';
import { formatMessage } from './format.js';

/** @typedef {'ro'|'en'} Locale */

/** @type {import('@preact/signals').Signal<Locale>} */
export const locale = signal('ro');
/** @type {Record<string, string>} */
let messages = {};
/** The locale whose messages are loaded, or null before the first load. */
export let loadedLocale = /** @type {Locale|null} */ (null);
/** Bumped after each load so components re-render. */
export const i18nVersion = signal(0);

/** @param {Record<string, any>} obj @param {string} [prefix] @param {Record<string,string>} [out] */
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

/** @param {Locale} next */
export async function loadLocale(next) {
  const res = await fetch(`/app/i18n/${next}.json`);
  messages = flatten(await res.json());
  loadedLocale = next;
  locale.value = next;
  document.documentElement.lang = next;
  i18nVersion.value++;
}

export const intlLocale = () => (locale.value === 'en' ? 'en-GB' : 'ro-RO');

/**
 * Translate a key. Reading `i18nVersion` subscribes the calling component.
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 */
export function t(key, params) {
  void i18nVersion.value;
  const src = messages[key];
  if (src === undefined) {
    console.warn(`i18n: missing key "${key}"`);
    return key;
  }
  return formatMessage(src, params, intlLocale());
}

/** Does a key exist (e.g. for error codes)? @param {string} key */
export const has = (key) => key in messages;
