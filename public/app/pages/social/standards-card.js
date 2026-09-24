import { html } from '../../html.js';
import { t } from '../../i18n/index.js';
import { Icon } from '../../components/ui.js';

/** Live summary of the format's standards; collapsible. @param {{format: any, open: boolean, onToggle: (o: boolean) => void}} p */
export function StandardsCard({ format: f, open, onToggle }) {
  return html`<details class="standards-card card" open=${open} onToggle=${(/** @type {any} */ e) => onToggle(e.currentTarget.open)}>
    <summary><${Icon} name="badge-check" /><span>${t('social.standardsFor', { name: f.name })}</span><${Icon} name="chevron-down" class="summary-chevron" /></summary>
    <${StandardsList} format=${f} />
    <p class="standards-all small"><a href="/social/standards" target="_blank">${t('social.allStandards')}</a></p>
  </details>`;
}

/** @param {{format: any}} p */
export function StandardsList({ format: f }) {
  const rows = standardsRows(f);
  return html`<dl class="standards-list">
    ${rows.map(([k, v]) => html`<div data-wide=${v.length > 32 ? 'true' : undefined}><dt>${t(`social.std_${k}`)}</dt><dd>${v}</dd></div>`)}
  </dl>`;
}

/** Every standard field of a format as [key, text] pairs, notes included. @param {any} f */
export function standardsRows(f) {
  const dur = [f.min_duration_s != null ? `min ${f.min_duration_s} s` : null, f.max_duration_s != null ? `max ${f.max_duration_s} s` : null].filter(Boolean).join(' · ');
  return /** @type {[string, string][]} */ ([
    ['kind', t(`social.kind_${f.media_kind}`)],
    ['ratio', f.ratio ?? `${f.ratio_w}:${f.ratio_h}`],
    ['resolution', `${f.width} × ${f.height}`],
    ['files', f.file_formats ?? '—'],
    ['duration', [dur, f.duration_note].filter(Boolean).join(' — ') || '—'],
    ['size', [f.max_file_mb != null ? `${f.max_file_mb} MB` : '', f.file_size_note].filter(Boolean).join(' — ') || '—'],
    ...(f.media_kind === 'carousel' ? [['items', String(f.max_items ?? 20)]] : []),
    ['caption', String(f.caption_limit)],
    ['hook', [f.hook_length != null ? String(f.hook_length) : '', f.hook_note].filter(Boolean).join(' — ') || '—'],
    ['safe', f.safe_zone ?? '—'],
  ]);
}
