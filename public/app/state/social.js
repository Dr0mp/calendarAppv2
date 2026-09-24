import { signal } from '@preact/signals';
import { api } from '../api.js';
import { refreshCounts } from './counts.js';

/** Platforms with their formats (admins only), cached per session. */
export const platforms = signal(/** @type {any[]|null} */ (null));
/** Bumped after any post change so open views reload. */
export const postsRevision = signal(0);

let loading = /** @type {Promise<void>|null} */ (null);

/** @param {boolean} [force] */
export function loadPlatforms(force = false) {
  if (!force && platforms.value) return Promise.resolve();
  loading ??= api('GET', '/platforms')
    .then((r) => {
      platforms.value = r.items;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** @param {any[]} items */
export const setPlatforms = (items) => {
  platforms.value = items;
};

export const invalidatePosts = () => {
  postsRevision.value++;
  // Posts change promotion status, which drives the queue badge.
  refreshCounts();
};

/** @param {string|null|undefined} id */
export const platformById = (id) => platforms.value?.find((p) => p.id === id) ?? null;

/** @param {string|null|undefined} id */
export function formatById(id) {
  for (const p of platforms.value ?? []) {
    const f = p.formats.find((/** @type {any} */ x) => x.id === id);
    if (f) return f;
  }
  return null;
}
