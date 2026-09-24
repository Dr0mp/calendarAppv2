import { html } from '../../html.js';
import { t } from '../../i18n/index.js';
import { EmptyState } from '../../components/ui.js';

export function Storage() {
  return html`<div class="page-head"><h1>${t('admin.storage')}</h1></div><${EmptyState} icon="hard-drive" title=${t('admin.storage')} />`;
}
