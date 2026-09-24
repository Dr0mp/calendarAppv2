import { useLocation } from 'preact-iso';
import { html, useState } from '../html.js';
import { t } from '../i18n/index.js';
import { Overlay } from './overlay.js';
import { EntryDetail, entryTitle } from '../pages/entry/detail.js';

/**
 * Opens the entry detail for `?entry=<id>` on any page: a side panel on
 * desktop, a full-screen sheet on phones. Reload and Back keep working.
 */
export function EntryOverlay() {
  const { query, url, route } = useLocation();
  const id = query.entry;
  const [title, setTitle] = useState('');
  const close = () => {
    const u = new URL(url, location.origin);
    u.searchParams.delete('entry');
    route(`${u.pathname}${u.search}`, true);
  };
  return html`<${Overlay} open=${!!id} onClose=${close} title=${title || t('entry.detailTitle')} phone="full"
    headerExtra=${id && html`<a class="btn btn--ghost btn--sm hide-compact" href=${`/entries/${id}`}>${t('entry.openPage')}</a>`}>
    ${id && html`<${EntryDetail} id=${id} onClose=${close} onLoaded=${(/** @type {any} */ e) => setTitle(entryTitle(e))} />`}
  </${Overlay}>`;
}
