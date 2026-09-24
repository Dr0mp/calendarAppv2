import { signal } from '@preact/signals';
import { get } from '../api.js';
import { session } from './session.js';

/** Nav badges: upcoming owned entries, pending promotions. */
export const counts = signal({ myUpcoming: 0, promotions: 0 });

let inflight = /** @type {Promise<void>|null} */ (null);
export function refreshCounts() {
  if (!session.value?.user) return Promise.resolve();
  inflight ??= get('/me/counts')
    .then((c) => {
      counts.value = c;
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
