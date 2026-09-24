import { signal } from '@preact/signals';
import { api } from '../api.js';

/**
 * Entries cache by date range. Views ask for a range; saves bump `revision`
 * so every visible view refetches.
 */
export const revision = signal(0);
export const invalidateEntries = () => {
  revision.value++;
};

/** @type {Map<string, {at: number, items: any[]}>} */
const cache = new Map();

/**
 * @param {{from: string, to: string, type?: string[], space?: string[], owner?: string, q?: string}} f
 * @param {{maxAgeMs?: number, signal?: AbortSignal}} [opts]
 */
export async function fetchEntries(f, opts = {}) {
  const key = JSON.stringify([f, revision.value]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (opts.maxAgeMs ?? 30_000)) return hit.items;
  const r = await api('GET', '/entries', { query: { ...f, type: f.type?.join(','), space: f.space?.join(',') }, signal: opts.signal });
  cache.set(key, { at: Date.now(), items: r.items });
  if (cache.size > 30) cache.delete(/** @type {string} */ (cache.keys().next().value));
  return r.items;
}

export function clearEntryCache() {
  cache.clear();
}
