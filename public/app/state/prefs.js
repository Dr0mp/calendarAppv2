import { signal, effect } from '@preact/signals';
import { loadLocale, loadedLocale } from '../i18n/index.js';
import { session } from './session.js';

/** Per-browser storage for UI state. Never throws. */
export const store = {
  /** @param {string} key @param {any} [fallback] */
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(`ca.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  /** @param {string} key @param {any} value */
  set(key, value) {
    try {
      if (value === undefined || value === null) localStorage.removeItem(`ca.${key}`);
      else localStorage.setItem(`ca.${key}`, JSON.stringify(value));
    } catch {
      /* private mode, quota… */
    }
  },
};

/** @type {import('@preact/signals').Signal<'system'|'light'|'dark'>} */
export const theme = signal(store.get('theme', 'system'));

effect(() => {
  document.documentElement.dataset.theme = theme.value;
});

/** Apply the signed-in user's saved preferences (account wins over localStorage). */
export async function applyUserPrefs() {
  const u = session.value?.user;
  const lang = u?.locale ?? store.get('locale') ?? session.value?.settings.defaultLocale ?? 'ro';
  if (u?.theme) theme.value = u.theme;
  const next = lang === 'en' ? 'en' : 'ro';
  if (next !== loadedLocale) await loadLocale(next);
}

/** @param {'system'|'light'|'dark'} next */
export function setThemeLocal(next) {
  theme.value = next;
  store.set('theme', next);
}

/** @param {'ro'|'en'} next */
export async function setLocaleLocal(next) {
  store.set('locale', next);
  await loadLocale(next);
}

/**
 * Change language: saved to the account when signed in, localStorage otherwise.
 * @param {'ro'|'en'} next
 */
export async function setLocale(next) {
  await setLocaleLocal(next);
  await saveToAccount({ locale: next });
}

/** @param {'system'|'light'|'dark'} next */
export async function setTheme(next) {
  setThemeLocal(next);
  await saveToAccount({ theme: next });
}

/** @param {Record<string, string>} patch */
async function saveToAccount(patch) {
  const s = session.value;
  if (!s?.user) return;
  const { api } = await import('../api.js');
  try {
    const u = await api('PATCH', '/me', { body: patch, version: s.user.version });
    session.value = { ...s, user: { ...s.user, ...u } };
  } catch {
    /* a stale version is harmless here: the next load refreshes it */
  }
}
