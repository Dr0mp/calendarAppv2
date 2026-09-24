import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { api } from '../../api.js';
import { Alert, Icon, Meter, Skeleton } from '../../components/ui.js';
import { fmtBytes, fmtNumber } from '../../time.js';

export default function Overview() {
  const [data, setData] = useState(/** @type {any} */ (null));
  useEffect(() => {
    api('GET', '/admin/summary').then(setData);
  }, []);
  const cards = data
    ? [
        { icon: 'users', label: t('admin.activeUsers'), value: fmtNumber(data.activeUsers), href: '/admin/users' },
        { icon: 'calendar-days', label: t('admin.upcomingWeek'), value: fmtNumber(data.upcomingWeek), href: '/calendar?view=week' },
        { icon: 'megaphone', label: t('admin.pendingPromotions'), value: fmtNumber(data.pendingPromotions), href: '/social/queue' },
      ]
    : [];
  return html`<div class="stack">
    <div class="page-head"><h1>${t('admin.overview')}</h1></div>
    ${data?.migration?.neverSignedIn?.length > 0 && html`<${Alert} tone="warning" title=${t('admin.migratedNeverTitle', { n: data.migration.neverSignedIn.length })}>
      <p>${t('admin.migratedNeverText')}</p>
      <ul class="plain-list">${data.migration.neverSignedIn.map((/** @type {any} */ u) => html`<li>${u.name} <span class="muted">@${u.username}</span></li>`)}</ul>
      <p><a href="/admin/users">${t('admin.openUsers')}</a></p>
    </${Alert}>`}
    <div class="stat-grid">
      ${!data
        ? Array.from({ length: 4 }, () => html`<${Skeleton} h="112px" />`)
        : html`${cards.map(
            (c) => html`<a class="stat card" href=${c.href}>
              <span class="stat-icon"><${Icon} name=${c.icon} /></span>
              <span class="stat-value num">${c.value}</span>
              <span class="stat-label">${c.label}</span>
            </a>`,
          )}
          <a class="stat card" href="/admin/storage">
            <span class="stat-icon"><${Icon} name="hard-drive" /></span>
            <span class="stat-value num">${Math.round(data.storage.pct * 100)}%</span>
            <span class="stat-label">${t('admin.storageUsed', { used: fmtBytes(data.storage.used), cap: fmtBytes(data.storage.cap) })}</span>
            <${Meter} value=${data.storage.pct} label=${t('admin.storage')} level=${data.storage.level} />
          </a>`}
    </div>
  </div>`;
}
