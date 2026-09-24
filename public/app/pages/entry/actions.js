import { t } from '../../i18n/index.js';
import { api, ApiError } from '../../api.js';
import { confirm } from '../../components/overlay.js';
import { toast } from '../../components/toast.js';
import { invalidateEntries } from '../../state/entries.js';
import { refreshCounts } from '../../state/counts.js';
import { entryTitle } from './detail-title.js';

/**
 * Delete an entry, asking for the scope when it belongs to a series. Cancel
 * always aborts. Returns true when something was deleted.
 * @param {any} e
 */
export async function deleteEntryFlow(e) {
  /** @type {string|null} */
  let scope;
  if (e.series_id) {
    scope = await confirm({
      title: t('series.deleteScopeTitle', { title: entryTitle(e) }),
      confirmLabel: t('common.delete'),
      danger: true,
      choices: [
        { value: 'one', label: t('series.scopeOne') },
        { value: 'following', label: t('series.scopeFollowing'), hint: t('series.scopeFollowingHint') },
        { value: 'all', label: t('series.scopeAll'), hint: t('series.scopeAllHint') },
      ],
    });
  } else {
    const ok = await confirm({
      title: t('entry.deleteTitle', { title: entryTitle(e) }),
      message: e.past ? t('entry.deletePastText') : t('entry.deleteText'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    scope = ok ? 'one' : null;
  }
  if (!scope) return false;
  try {
    const r = await api('DELETE', `/entries/${e.id}`, { version: e.version, query: { scope } });
    toast('success', r.deleted > 1 ? t('series.deletedN', { n: r.deleted }) : t('entry.deleted'));
    invalidateEntries();
    refreshCounts();
    return true;
  } catch (err) {
    toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
    return false;
  }
}
