import { signal } from '@preact/signals';
import { api } from '../api.js';

/** Spaces, rooms and the user directory, cached per session. */
export const spaces = signal(/** @type {any[]|null} */ (null));
export const rooms = signal(/** @type {any[]|null} */ (null));
export const directory = signal(/** @type {any[]|null} */ (null));

let loading = /** @type {Promise<void>|null} */ (null);

/** @param {boolean} [force] */
export function loadVenues(force = false) {
  if (!force && spaces.value && rooms.value && directory.value) return Promise.resolve();
  loading ??= Promise.all([api('GET', '/spaces'), api('GET', '/rooms'), api('GET', '/users/directory')])
    .then(([s, r, d]) => {
      spaces.value = s.items;
      rooms.value = r.items;
      directory.value = d.items;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** @param {string|null|undefined} id */
export const spaceById = (id) => spaces.value?.find((s) => s.id === id) ?? null;
/** @param {string|null|undefined} id */
export const roomById = (id) => rooms.value?.find((r) => r.id === id) ?? null;
/** @param {string|null|undefined} id */
export const userById = (id) => directory.value?.find((u) => u.id === id) ?? null;
