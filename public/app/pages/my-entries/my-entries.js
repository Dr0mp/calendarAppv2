import { useLocation } from 'preact-iso';
import { html, useEffect, useMemo, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { isStaff, isAdmin } from '../../state/session.js';
import { usePageChrome } from '../../state/chrome.js';
import { revision, invalidateEntries } from '../../state/entries.js';
import { refreshCounts } from '../../state/counts.js';
import { api, ApiError } from '../../api.js';
import { Badge, Button, EmptyState, Icon, SearchField, SkeletonList, Tabs } from '../../components/ui.js';
import { confirm } from '../../components/overlay.js';
import { toast } from '../../components/toast.js';
import { fmtDateShort, fmtDayMonth } from '../../time.js';
import { TYPE_ICON, TYPE_TONE, entryTitle, priceText } from '../entry/detail.js';

/** @param {string} s */
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function MyEntries() {
  usePageChrome(t('nav.myEvents'), html`<a class="btn btn--primary btn--sm" href="/schedule"><svg class="icon" aria-hidden="true"><use href="/icons.svg#i-plus"></use></svg>${t('nav.schedule')}</a>`);
  const { query, route, url } = useLocation();
  const [items, setItems] = useState(/** @type {any[]|null} */ (null));
  const [q, setQ] = useState(query.q ?? '');
  const [showPast, setShowPast] = useState(false);
  const tab = query.tab ?? 'all';

  const load = () => api('GET', '/entries', { query: { owner: 'me' } }).then((r) => setItems(r.items));
  useEffect(() => {
    load();
  }, [revision.value]);

  /** @param {string} v */
  const setTab = (v) => {
    const u = new URL(url, location.origin);
    if (v === 'all') u.searchParams.delete('tab');
    else u.searchParams.set('tab', v);
    route(`${u.pathname}${u.search}`, true);
  };

  const counts = useMemo(() => {
    const c = { all: 0, event: 0, blocked: 0, room_only: 0 };
    for (const e of items ?? []) {
      c.all++;
      c[/** @type {'event'} */ (e.type)]++;
    }
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (tab !== 'all') list = list.filter((e) => e.type === tab);
    const s = fold(q.trim());
    if (s) {
      list = list.filter((e) =>
        fold([e.title, e.description, e.space?.name, ...e.room_bookings.map((/** @type {any} */ b) => `${b.room_name} ${b.guest_names ?? ''}`)].filter(Boolean).join(' ')).includes(s),
      );
    }
    return list;
  }, [items, tab, q]);

  const upcoming = filtered.filter((e) => !e.past).sort((a, b) => nextKey(a).localeCompare(nextKey(b)));
  const past = filtered.filter((e) => e.past).sort((a, b) => nextKey(b).localeCompare(nextKey(a)));

  /** @param {any} e */
  async function remove(e) {
    const ok = await confirm({ title: t('entry.deleteTitle', { title: entryTitle(e) }), message: t('entry.deleteText'), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return;
    try {
      await api('DELETE', `/entries/${e.id}`, { version: e.version, query: { scope: 'one' } });
      toast('success', t('entry.deleted'));
      invalidateEntries();
      refreshCounts();
    } catch (err) {
      toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
    }
  }

  const tabs = [
    { value: 'all', label: t('myEntries.all'), count: counts.all },
    { value: 'event', label: t('myEntries.events'), count: counts.event },
    { value: 'blocked', label: t('myEntries.blocks'), count: counts.blocked },
    ...(isStaff.value ? [{ value: 'room_only', label: t('myEntries.bookings'), count: counts.room_only }] : []),
  ];

  return html`<div class="my-entries stack">
    <div class="page-head">
      <h1>${t('nav.myEvents')}</h1>
      <${Button} variant="primary" icon="plus" href="/schedule" class="hide-compact">${t('nav.schedule')}</${Button}>
      <p class="page-sub">${t('myEntries.sub')}</p>
    </div>
    <div class="toolbar">
      <${SearchField} value=${q} onInput=${setQ} placeholder=${t('myEntries.search')} class="toolbar-search" />
    </div>
    <${Tabs} label=${t('myEntries.filter')} items=${tabs} value=${tab} onChange=${setTab} />
    ${items === null
      ? html`<${SkeletonList} rows=${4} />`
      : items.length === 0
        ? html`<${EmptyState} icon="calendar-plus" title=${t('myEntries.emptyTitle')} text=${t('myEntries.emptyText')}
            action=${html`<${Button} variant="primary" icon="plus" href="/schedule">${t('nav.schedule')}</${Button}>`} />`
        : filtered.length === 0
          ? html`<${EmptyState} icon="search" title=${t('myEntries.noMatchTitle')} text=${t('myEntries.noMatchText')}
              action=${html`<${Button} onClick=${() => (setQ(''), setTab('all'))}>${t('myEntries.resetFilters')}</${Button}>`} />`
          : html`
            <section aria-labelledby="my-upcoming" class="stack">
              <h2 id="my-upcoming" class="section-title">${t('myEntries.upcoming')} · ${upcoming.length}</h2>
              ${upcoming.length ? html`<div class="entry-cards">${upcoming.map((e) => html`<${EntryCard} e=${e} onDelete=${remove} />`)}</div>`
                : html`<p class="muted small">${t('myEntries.noneUpcoming')}</p>`}
            </section>
            ${past.length > 0 && html`<section class="stack">
              <button type="button" class="section-toggle" aria-expanded=${showPast ? 'true' : 'false'} onClick=${() => setShowPast(!showPast)}>
                <${Icon} name=${showPast ? 'chevron-down' : 'chevron-right'} /><span class="section-title">${t('myEntries.past')} · ${past.length}</span>
              </button>
              ${showPast && html`<div class="entry-cards">${past.map((e) => html`<${EntryCard} e=${e} onDelete=${remove} />`)}</div>`}
            </section>`}`}
  </div>`;
}

/** Sort key: next session (or check-in) that is not over. @param {any} e */
function nextKey(e) {
  if (e.sessions.length) return `${e.sessions[0].date} ${e.sessions[0].start}`;
  return e.first_date;
}

/** @param {{e: any, onDelete: (e: any) => void}} p */
function EntryCard({ e, onDelete }) {
  const s = e.sessions[0];
  const when = s
    ? `${fmtDateShort(s.date)} · ${s.start}–${s.end}${e.sessions.length > 1 ? ` · ${t('schedule.nSessions', { n: e.sessions.length })}` : ''}`
    : e.room_bookings.length ? `${fmtDayMonth(e.room_bookings[0].check_in)} → ${fmtDayMonth(e.room_bookings[0].check_out)}` : '';
  const where = [e.space?.name, ...e.room_bookings.map((/** @type {any} */ b) => b.room_name)].filter(Boolean).join(' · ');
  return html`<article class="entry-card card" data-type=${e.type} style=${{ '--owner': `var(--${e.owner.color})` }}>
    <div class="entry-card-main">
      <div class="cluster" style=${{ '--cluster-gap': 'var(--space-2)' }}>
        <${Badge} tone=${TYPE_TONE[e.type]} icon=${TYPE_ICON[e.type]}>${t(`entryType.${e.type}`)}</${Badge}>
        ${e.series_id && html`<${Badge} icon="repeat">${t('entry.seriesOf', { i: (e.occurrence_index ?? 0) + 1, n: e.series_total })}</${Badge}>`}
        <span class="small muted num">${when}</span>
      </div>
      <h3 class="entry-card-title"><a href=${`?entry=${e.id}`}>${entryTitle(e)}</a></h3>
      ${where && html`<p class="small muted"><${Icon} name="map-pin" /> ${where}</p>`}
      ${e.type === 'event' && html`<p class="small">${priceText(e)}${isAdmin.value && e.promotion_status ? html` · <span class="muted">${t(`entry.promo_${e.promotion_status}`)}</span>` : ''}</p>`}
    </div>
    <div class="entry-card-actions">
      ${e.can_edit && html`<a class="btn btn--sm btn--secondary" href=${`/entries/${e.id}/edit`}><${Icon} name="pencil" />${t('common.edit')}</a>`}
      <a class="btn btn--sm btn--ghost" href=${`?entry=${e.id}`}><${Icon} name="eye" />${t('myEntries.details')}</a>
      <a class="btn btn--sm btn--ghost" href=${`/schedule?duplicate=${e.id}`}><${Icon} name="copy" />${t('entry.duplicate')}</a>
      ${e.can_delete && html`<button type="button" class="btn btn--sm btn--danger-ghost" onClick=${() => onDelete(e)}><${Icon} name="trash-2" />${t('common.delete')}</button>`}
    </div>
  </article>`;
}
