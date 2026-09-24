import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { Badge, Button, Icon } from '../../components/ui.js';

export const RATIO_MIN = 1.7;
export const RATIO_MAX = 1.85;

/**
 * Describe an image's shape for the badge.
 * @param {number} w @param {number} h
 */
export function describeShape(w, h) {
  const r = w / h;
  if (r >= RATIO_MIN && r <= RATIO_MAX) return { ok: true, label: '16:9' };
  if (Math.abs(r - 1) < 0.05) return { ok: false, label: t('schedule.shapeSquare') };
  if (r < 1) return { ok: false, label: t('schedule.shapePortrait') };
  if (r > 2.2) return { ok: false, label: t('schedule.shapeUltraWide') };
  return { ok: false, label: t('schedule.shapeRatio', { r: r.toFixed(2).replace('.', ',') }) };
}

/**
 * @typedef {{status: 'empty'|'loading'|'ok'|'bad'|'error', w?: number, h?: number, label?: string, small?: boolean}} CoverCheck
 */

/**
 * Load an image and report its dimensions in the browser.
 * @param {string} src
 * @returns {Promise<CoverCheck>}
 */
export function checkImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const shape = describeShape(w, h);
      resolve({ status: shape.ok ? 'ok' : 'bad', w, h, label: shape.label, small: w < 1200 || h < 675 });
    };
    img.onerror = () => resolve({ status: 'error' });
    img.src = src;
  });
}

/**
 * Section F cover picker: paste an https URL (uploads and the library arrive
 * with media support). Shows a preview and a badge.
 * @param {{url: string, mediaId: string|null, onChange: (p: {cover_url?: string, cover_media_id?: string|null}) => void,
 *   onCheck: (c: CoverCheck) => void, check: CoverCheck, error?: string|null, extra?: any}} p
 */
export function CoverPicker({ url, mediaId, onChange, onCheck, check, error, extra }) {
  const src = mediaId ? `/media/${mediaId}/original` : url.trim();
  const [draft, setDraft] = useState(url);
  useEffect(() => setDraft(url), [url]);
  useEffect(() => {
    if (!src || (!mediaId && !/^https:\/\//.test(src))) {
      onCheck({ status: src ? 'error' : 'empty' });
      return;
    }
    let live = true;
    onCheck({ status: 'loading' });
    checkImage(src).then((c) => live && onCheck(c));
    return () => {
      live = false;
    };
  }, [src]);

  return html`<div class="cover-picker stack" style=${{ '--stack-gap': 'var(--space-3)' }}>
    <div class="cover-preview" data-status=${check.status}>
      ${src && check.status !== 'error'
        ? html`<img src=${src} alt=${t('schedule.coverPreview')} referrerpolicy="no-referrer" />`
        : html`<div class="cover-empty"><${Icon} name="image" /><span class="small muted">${t('schedule.coverEmpty')}</span></div>`}
      ${check.status === 'ok' && html`<${Badge} tone="success" icon="circle-check" class="cover-badge">${check.w} × ${check.h} · 16:9</${Badge}>`}
      ${check.status === 'bad' && html`<${Badge} tone="danger" icon="circle-x" class="cover-badge">${check.w} × ${check.h} · ${check.label}</${Badge}>`}
      ${check.status === 'error' && src && html`<${Badge} tone="danger" icon="circle-alert" class="cover-badge">${t('schedule.coverLoadError')}</${Badge}>`}
    </div>
    ${check.status === 'ok' && check.small && html`<p class="small text-warning"><${Icon} name="triangle-alert" /> ${t('schedule.coverSmall')}</p>`}
    ${check.status === 'bad' && html`<p class="small text-danger">${t('schedule.coverWrongShape')}</p>`}
    <div class="cluster">
      <input id="f-cover" class="input grow" type="url" inputMode="url" placeholder="https://…" value=${draft}
        aria-label=${t('schedule.coverUrl')} aria-invalid=${error ? 'true' : undefined}
        onInput=${(/** @type {any} */ e) => setDraft(e.currentTarget.value)}
        onChange=${(/** @type {any} */ e) => onChange({ cover_url: e.currentTarget.value.trim(), cover_media_id: null })} />
      ${(url || mediaId) && html`<${Button} variant="ghost" size="sm" onClick=${() => onChange({ cover_url: '', cover_media_id: null })}>${t('common.remove')}</${Button}>`}
    </div>
    ${extra}
    ${error && html`<div class="field-error"><${Icon} name="circle-alert" />${error}</div>`}
  </div>`;
}
