import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { usePageChrome } from '../../state/chrome.js';
import { loadPlatforms, platforms } from '../../state/social.js';
import { Button, Select, SkeletonList } from '../../components/ui.js';
import { PlatformIcon } from '../../components/platform-icon.js';
import { standardsRows } from './standards-card.js';

/** "Standarde platforme": every format of every enabled platform, filterable and printable. */
export default function Standards() {
  usePageChrome(t('social.standards'));
  const [platform, setPlatform] = useState('');
  useEffect(() => {
    loadPlatforms();
  }, []);
  const list = (platforms.value ?? []).filter((p) => p.enabled && (!platform || p.id === platform));
  const keys = ['kind', 'ratio', 'resolution', 'files', 'duration', 'size', 'items', 'caption', 'hook', 'safe'];

  return html`<div class="stack standards-page">
    <div class="page-head">
      <h1>${t('social.standards')}</h1>
      <div class="cluster">
        <a class="btn btn--secondary" href="/social/platforms">${t('social.platforms')}</a>
        <${Button} icon="printer" onClick=${() => window.print()}>${t('social.print')}</${Button}>
      </div>
      <p class="page-sub">${t('social.standardsIntro')}</p>
    </div>
    <div class="toolbar">
      <${Select} value=${platform} onChange=${setPlatform} aria-label=${t('social.platformFilter')}
        options=${[{ value: '', label: t('social.allPlatforms') }, ...(platforms.value ?? []).filter((p) => p.enabled).map((p) => ({ value: p.id, label: p.name }))]} />
    </div>
    ${platforms.value === null
      ? html`<${SkeletonList} rows=${4} />`
      : html`<div class="table-wrap" tabindex="0" role="region" aria-label=${t('social.standards')}>
          <table class="table standards-table">
            <caption class="sr-only">${t('social.standards')}</caption>
            <thead><tr>
              <th scope="col">${t('social.platform')}</th><th scope="col">${t('social.format')}</th>
              ${keys.map((k) => html`<th scope="col">${t(`social.std_${k}`)}</th>`)}
            </tr></thead>
            <tbody>
              ${list.flatMap((p) => p.formats.map((/** @type {any} */ f) => {
                const rows = Object.fromEntries(standardsRows(f));
                return html`<tr>
                  <td><span class="cluster" style=${{ '--cluster-gap': '6px', flexWrap: 'nowrap' }}><${PlatformIcon} platform=${p} size=${16} />${p.name}</span></td>
                  <th scope="row">${f.name}</th>
                  ${keys.map((k) => html`<td>${rows[k] ?? '—'}</td>`)}
                </tr>`;
              }))}
            </tbody>
          </table>
        </div>`}
  </div>`;
}
