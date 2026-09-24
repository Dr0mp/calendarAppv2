import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { api, ApiError } from '../../api.js';
import { directory, loadVenues } from '../../state/venues.js';
import { invalidateEntries } from '../../state/entries.js';
import { Button, RadioGroup, Select } from '../../components/ui.js';
import { Modal } from '../../components/overlay.js';
import { toast } from '../../components/toast.js';

/**
 * Reassign one entry (with a scope for series) or several selected entries.
 * @param {{entries: any[], onClose: () => void, onDone: () => void}} p
 */
export function ReassignDialog({ entries, onClose, onDone }) {
  const [owner, setOwner] = useState('');
  const [scope, setScope] = useState('one');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadVenues();
  }, []);
  const single = entries.length === 1 ? entries[0] : null;

  async function submit() {
    setBusy(true);
    try {
      if (single) await api('POST', `/entries/${single.id}/reassign`, { body: { ownerId: owner, ...(single.series_id ? { scope } : {}) } });
      else await api('POST', '/admin/entries/bulk', { body: { action: 'reassign', ids: entries.map((e) => e.id), ownerId: owner } });
      toast('success', single ? t('entry.reassigned') : t('admin.reassignedN', { n: entries.length }));
      invalidateEntries();
      onDone();
    } catch (err) {
      toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }
  const users = (directory.value ?? []).filter((u) => !single || u.id !== single.owner.id);
  return html`<${Modal} open onClose=${onClose} title=${single ? t('entry.reassignTitle') : t('admin.reassignNTitle', { n: entries.length })}
    footer=${html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
      <${Button} variant="primary" busy=${busy} disabled=${!owner} onClick=${submit}>${t('entry.reassign')}</${Button}>`}>
    <div class="stack">
      <div class="field">
        <label for="reassign-owner">${t('entry.newOwner')}</label>
        <${Select} id="reassign-owner" value=${owner} onChange=${setOwner} placeholder=${t('admin.chooseUser')}
          options=${users.map((u) => ({ value: u.id, label: u.name }))} />
      </div>
      ${single?.series_id && html`<${RadioGroup} legend=${t('series.scopeLegend')} name="reassign-scope" value=${scope} onChange=${setScope}
        options=${[
          { value: 'one', label: t('series.scopeOne') },
          { value: 'following', label: t('series.scopeFollowing'), hint: t('series.scopeFollowingHint') },
          { value: 'all', label: t('series.scopeAll'), hint: t('series.scopeAllHint') },
        ]} />`}
    </div>
  </${Modal}>`;
}
