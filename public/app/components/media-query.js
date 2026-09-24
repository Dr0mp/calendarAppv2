import { signal } from '@preact/signals';

/** @param {string} query */
function mq(query) {
  const m = window.matchMedia(query);
  const s = signal(m.matches);
  m.addEventListener('change', (e) => (s.value = e.matches));
  return s;
}

/** ≤ 900 px: tablet and phone layout (bottom tab bar, sheets). */
export const isCompact = mq('(width <= 900px)');
/** ≤ 640 px: phone. */
export const isPhone = mq('(width <= 640px)');
export const reducedMotion = mq('(prefers-reduced-motion: reduce)');
