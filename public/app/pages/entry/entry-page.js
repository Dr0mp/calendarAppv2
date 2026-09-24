import { useRoute } from 'preact-iso';
import { html, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { usePageChrome } from '../../state/chrome.js';
import { EntryDetail, entryTitle } from './detail.js';

/** /entries/:id — the entry's own page (deep links). */
export default function EntryPage() {
  const { params } = useRoute();
  const [title, setTitle] = useState('');
  usePageChrome(title || t('entry.detailTitle'));
  return html`<div class="entry-page">
    <div class="page-head"><h1>${title || t('entry.detailTitle')}</h1>
      <a class="btn btn--ghost" href="/calendar">${t('shell.backToCalendar')}</a></div>
    <div class="card card-body entry-page-card">
      <${EntryDetail} id=${params.id} onClose=${() => history.back()} onLoaded=${(/** @type {any} */ e) => setTitle(entryTitle(e))} />
    </div>
  </div>`;
}
