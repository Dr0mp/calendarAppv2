import { html } from '../../html.js';
import { t } from '../../i18n/index.js';
import { EmptyState } from '../../components/ui.js';

export function AllEntries() {
  return html`<div class="page-head"><h1>${t('admin.entries')}</h1></div><${EmptyState} icon="clipboard-list" title=${t('admin.entries')} />`;
}
