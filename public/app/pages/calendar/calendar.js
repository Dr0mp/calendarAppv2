import { html } from '../../html.js';
import { t } from '../../i18n/index.js';
import { usePageChrome } from '../../state/chrome.js';
import { EmptyState } from '../../components/ui.js';

export default function Page() {
  usePageChrome(t('nav.calendar'));
  return html`<div class="page-head"><h1>${t('nav.calendar')}</h1></div>
    <${EmptyState} icon="sparkles" title=${t('nav.calendar')} text="…" />`;
}
