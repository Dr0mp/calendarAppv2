// Section D: recurrence. The full editor arrives with milestone M5.
import { html } from '../../html.js';
import { t } from '../../i18n/index.js';

/** @param {{form: import('./model.js').FormState, set: (p: any) => void}} _p */
export function RecurrenceSection(_p) {
  return html`<p class="small muted">${t('schedule.recurrenceSoon')}</p>`;
}

/** @param {import('./model.js').FormState} _f */
export function recurrenceSummary(_f) {
  return '';
}
