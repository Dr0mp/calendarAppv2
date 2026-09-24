import { signal, computed } from '@preact/signals';

/**
 * @typedef {{
 *   id: string, username: string, email: string|null, name: string, role: 'user'|'moderator'|'admin',
 *   isRoot: boolean, isDemo: boolean, initials: string, color: string, locale: 'ro'|'en'|null,
 *   theme: 'system'|'light'|'dark'|null, version: number, passkeyCount: number
 * }} User
 * @typedef {{
 *   user: User|null, workspace: 'main'|'demo'|null, csrfToken: string|null,
 *   settings: {tz: string, orgName: string, defaultLocale: 'ro'|'en'},
 *   features: {demo: boolean, email: boolean, dev: boolean},
 *   storage: null|'warn'|'critical'|'full'
 * }} Session
 */

/** @type {import('@preact/signals').Signal<Session|null>} */
export const session = signal(null);

export const user = computed(() => session.value?.user ?? null);
export const isAdmin = computed(() => user.value?.role === 'admin');
export const isStaff = computed(() => user.value?.role === 'admin' || user.value?.role === 'moderator');
export const isDemo = computed(() => session.value?.workspace === 'demo');
export const orgTz = computed(() => session.value?.settings.tz ?? 'Europe/Bucharest');

export async function refreshSession() {
  // The first load uses the payload the server embedded in the page.
  const embedded = document.getElementById('session-data');
  if (embedded) {
    embedded.remove();
    try {
      session.value = JSON.parse(embedded.textContent ?? '');
      return session.value;
    } catch {
      /* fall back to the API */
    }
  }
  const res = await fetch('/api/v1/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  session.value = await res.json();
  return session.value;
}

/** Called by the API layer on 401: drop the user so the router shows sign-in. */
export function onUnauthorized() {
  if (session.value?.user) session.value = { ...session.value, user: null, csrfToken: null, workspace: null };
}
