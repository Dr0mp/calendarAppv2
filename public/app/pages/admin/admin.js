import { useLocation, useRoute } from 'preact-iso';
import { html, useEffect } from '../../html.js';
import { t } from '../../i18n/index.js';
import { session } from '../../state/session.js';
import { store } from '../../state/prefs.js';
import { usePageChrome } from '../../state/chrome.js';
import { Icon } from '../../components/ui.js';
import { isCompact } from '../../components/media-query.js';
import Overview from './overview.js';
import Users from './users.js';
import { Spaces, Rooms } from './venues.js';
import Settings from './settings.js';
import { AllEntries } from './entries.js';
import { Storage } from './storage.js';

export const SECTIONS = [
  { id: '', icon: 'layout-grid', key: 'admin.overview' },
  { id: 'users', icon: 'users', key: 'admin.users' },
  { id: 'spaces', icon: 'building-2', key: 'admin.spaces' },
  { id: 'rooms', icon: 'bed', key: 'admin.rooms' },
  { id: 'entries', icon: 'clipboard-list', key: 'admin.entries' },
  { id: 'storage', icon: 'hard-drive', key: 'admin.storage' },
  { id: 'settings', icon: 'settings', key: 'admin.settings' },
];

export default function Admin() {
  const { params } = useRoute();
  const { route } = useLocation();
  const section = params.section ?? '';
  const current = SECTIONS.find((s) => s.id === section);
  usePageChrome(current ? t(current.key) : t('nav.admin'));

  // Remember the last admin tab (UI state, per browser).
  useEffect(() => {
    if (section) store.set('adminTab', section);
  }, [section]);
  useEffect(() => {
    const last = store.get('adminTab');
    if (!section && last && isCompact.value && SECTIONS.some((s) => s.id === last)) route(`/admin/${last}`, true);
  }, []);

  const level = session.value?.storage;
  const Body = { '': Overview, users: Users, spaces: Spaces, rooms: Rooms, entries: AllEntries, storage: Storage, settings: Settings }[section];

  return html`<div class="admin">
    ${level &&
    html`<div class=${`banner ${level === 'warn' ? '' : 'banner--danger'} mb-4`} role="status">
      <${Icon} name=${level === 'warn' ? 'triangle-alert' : 'circle-alert'} />
      <span class="grow">${t(level === 'warn' ? 'admin.storageWarn' : level === 'full' ? 'admin.storageFull' : 'admin.storageCritical')}</span>
      <a href="/admin/storage">${t('admin.openStorage')}</a>
    </div>`}
    <div class="split">
      <nav class="subnav" aria-label=${t('nav.admin')}>
        ${SECTIONS.map(
          (s) => html`<a href=${`/admin${s.id ? `/${s.id}` : ''}`} class="subnav-link" aria-current=${s.id === section ? 'page' : undefined}>
            <${Icon} name=${s.icon} /><span>${t(s.key)}</span>
          </a>`,
        )}
      </nav>
      <div class="admin-body">${Body ? html`<${Body} />` : html`<p>${t('shell.notFoundTitle')}</p>`}</div>
    </div>
  </div>`;
}
