import { html } from '../../html.js';
import { t } from '../../i18n/index.js';
import { usePageChrome } from '../../state/chrome.js';
import { EmptyState } from '../../components/ui.js';

export default function Page() {
  usePageChrome(t('nav.schedule'));
  return html`<div class="page-head"><h1>${t('nav.schedule')}</h1></div>
    <${EmptyState} icon="sparkles" title=${t('nav.schedule')} text="…" />`;
}
