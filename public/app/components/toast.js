import { signal } from '@preact/signals';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon, IconButton } from './ui.js';

/** @typedef {{id: number, kind: 'info'|'success'|'warning'|'danger', text: string}} Toast */

/** @type {import('@preact/signals').Signal<Toast[]>} */
export const toasts = signal([]);
let seq = 0;

/** @param {number} id */
export const dismissToast = (id) => (toasts.value = toasts.value.filter((x) => x.id !== id));

/**
 * Show a toast. Auto-dismisses after 5 s, except danger toasts.
 * @param {Toast['kind']} kind @param {string} text
 */
export function toast(kind, text) {
  const id = ++seq;
  toasts.value = [...toasts.value.slice(-3), { id, kind, text }];
  if (kind !== 'danger') setTimeout(() => dismissToast(id), 5000);
  return id;
}

const ICONS = { info: 'info', success: 'circle-check', warning: 'triangle-alert', danger: 'circle-alert' };

export function Toaster() {
  return html`<div class="toasts" aria-live="polite" aria-relevant="additions">
    ${toasts.value.map(
      (x) => html`<div class=${`toast toast--${x.kind}`} role=${x.kind === 'danger' ? 'alert' : 'status'} key=${x.id}>
        <${Icon} name=${ICONS[x.kind]} />
        <span class="toast-msg">${x.text}</span>
        <${IconButton} icon="x" size="sm" label=${t('common.dismiss')} onClick=${() => dismissToast(x.id)} />
      </div>`,
    )}
  </div>`;
}
