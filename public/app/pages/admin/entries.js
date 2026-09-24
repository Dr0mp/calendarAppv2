import { useLocation } from 'preact-iso';
import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { api, errorText } from '../../api.js';
import { loadVenues, spaces, directory } from '../../state/venues.js';
import { revision, invalidateEntries } from '../../state/entries.js';
import { refreshCounts } from '../../state/counts.js';
import { Badge, Button, EmptyState, Icon, IconButton, Input, SearchField, Select, SkeletonList } from '../../components/ui.js';
import { confirm } from '../../components/overlay.js';
import { DataTable } from '../../components/table.js';
import { isCompact } from '../../components/media-query.js';
import { toast } from '../../components/toast.js';
import { fmtDateShort, fmtDayMonth, fmtInstant, fmtMoney, today } from '../../time.js';
import { TYPE_ICON, TYPE_TONE } from '../entry/detail.js';
import { deleteEntryFlow } from '../entry/actions.js';
import { ReassignDialog } from '../entry/reassign.js';

const KEYS = ['from', 'to', 'type', 'space', 'owner', 'promotion', 'q', 'page'];

/** "Toate înregistrările": every entry, filterable, with bulk actions and CSV export. */
export function AllEntries() {
  const { query, path, route } = useLocation();
  const f = Object.fromEntries(KEYS.map((k) => [k, query[k] ?? '']));
  const [data, setData] = useState(/** @type {any} */ (null));
  const [selected, setSelected] = useState(/** @type {Set<string>} */ (new Set()));
  const [reassign, setReassign] = useState(/** @type {any[]|null} */ (null));
  const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v));

  const load = () =>
    api('GET', '/admin/entries', { query: Object.fromEntries(params) })
      .then(setData)
      .catch((err) => toast('danger', errorText(err.code)));
  useEffect(() => {
    loadVenues();
  }, []);
  useEffect(() => {
    load();
  }, [params.toString(), revision.value]);
  useEffect(() => setSelected(new Set()), [params.toString()]);

  /** @param {Record<string, string>} patch */
  const nav = (patch) => {
    const u = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries({ page: '', ...patch })) {
      if (v) u.set(k, v);
      else u.delete(k);
    }
    const s = u.toString();
    route(`${path}${s ? `?${s}` : ''}`, true);
  };

  async function bulkDelete() {
    const ok = await confirm({ title: t('admin.bulkDeleteTitle', { n: selected.size }), message: t('admin.bulkDeleteText'), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return;
    try {
      const r = await api('POST', '/admin/entries/bulk', { body: { action: 'delete', ids: [...selected] } });
      toast('success', t('admin.deletedN', { n: r.count }));
      setSelected(new Set());
      invalidateEntries();
      refreshCounts();
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    }
  }

  const rows = data?.items ?? [];
  const columns = [
    {
      key: 'when', label: t('admin.colWhen'), class: 'nowrap',
      render: (/** @type {any} */ e) => e.type === 'room_only'
        ? html`<span class="num">${fmtDayMonth(e.when.check_in)} → ${fmtDayMonth(e.when.check_out)}</span>`
        : html`<span class="num">${fmtDateShort(e.when.date)}</span>
          ${e.when.start && html`<br /><span class="num small muted">${e.when.start}–${e.when.end}${e.when.sessions > 1 ? ` · ${t('schedule.nSessions', { n: e.when.sessions })}` : ''}</span>`}`,
    },
    {
      key: 'title', label: t('admin.colTitle'), primary: true,
      render: (/** @type {any} */ e) => html`<div class="stack" style=${{ '--stack-gap': '2px' }}>
        <a href=${`?${new URLSearchParams({ ...Object.fromEntries(params), entry: e.id })}`} class="audit-title">${e.title}</a>
        <span class="cluster" style=${{ '--cluster-gap': '4px' }}>
          <${Badge} tone=${TYPE_TONE[/** @type {'event'} */ (e.type)]} icon=${TYPE_ICON[/** @type {'event'} */ (e.type)]}>${t(`entryType.${e.type}`)}</${Badge}>
          ${e.series_id && html`<${Badge} icon="repeat">${(e.occurrence_index ?? 0) + 1}/${e.series_total}</${Badge}>`}
        </span>
      </div>`,
    },
    { key: 'place', label: t('admin.colPlace'), render: (/** @type {any} */ e) => [e.space?.name, e.rooms].filter(Boolean).join(' · ') || html`<span class="muted">—</span>` },
    { key: 'owner', label: t('admin.colOwner'), render: (/** @type {any} */ e) => html`<span>${e.owner.name}${e.owner.former ? html` <span class="muted small">(${t('admin.formerUser')})</span>` : ''}</span>` },
    {
      key: 'promotion', label: t('admin.colPromotion'),
      render: (/** @type {any} */ e) => e.promotion_status
        ? html`<${Badge} tone=${e.promotion_status === 'promoted' ? 'success' : e.promotion_status === 'skipped' ? 'neutral' : 'warning'}>${t(`entry.promo_${e.promotion_status}`)}</${Badge}>`
        : html`<span class="muted">—</span>`,
    },
    {
      key: 'price', label: t('admin.colPrice'), class: 'num nowrap',
      render: (/** @type {any} */ e) => (e.type !== 'event' ? html`<span class="muted">—</span>` : e.price_cents == null ? t('entry.free') : fmtMoney(e.price_cents, e.currency)),
    },
    {
      key: 'updated', label: t('admin.colUpdated'),
      render: (/** @type {any} */ e) => html`<span class="small nowrap" title=${fmtInstant(e.updated_at)}>${fmtDayMonth(e.updated_at.slice(0, 10))}<br /><span class="muted">${e.updated_by?.name ?? '—'}</span></span>`,
    },
    {
      key: 'actions', label: t('common.actions'), actions: true,
      render: (/** @type {any} */ e) => html`<span class="table-actions">
        <a class="btn btn--ghost btn--sm btn--icon" href=${`/entries/${e.id}/edit`} aria-label=${t('common.editName', { name: e.title })} title=${t('common.edit')}><${Icon} name="pencil" /></a>
        <${IconButton} icon="user-round-cog" size="sm" label=${t('admin.reassignName', { name: e.title })} onClick=${() => setReassign([e])} />
        <${IconButton} icon="trash-2" size="sm" label=${t('common.deleteName', { name: e.title })} onClick=${() => deleteEntryFlow(e)} />
      </span>`,
    },
  ];

  const filters = html`<label class="audit-filter"><span class="small muted">${t('admin.from')}</span>
        <${Input} type="date" value=${f.from || today()} onInput=${(/** @type {string} */ v) => nav({ from: v === today() ? '' : v })} /></label>
      <label class="audit-filter"><span class="small muted">${t('admin.to')}</span>
        <${Input} type="date" value=${f.to} onInput=${(/** @type {string} */ v) => nav({ to: v })} /></label>
      <${Select} value=${f.type} onChange=${(/** @type {string} */ v) => nav({ type: v })} aria-label=${t('admin.filterType')} placeholder=${t('admin.anyType')}
        options=${['event', 'blocked', 'room_only'].map((x) => ({ value: x, label: t(`entryType.${x}`) }))} />
      <${Select} value=${f.space} onChange=${(/** @type {string} */ v) => nav({ space: v })} aria-label=${t('admin.filterSpace')} placeholder=${t('admin.anySpace')}
        options=${(spaces.value ?? []).map((s) => ({ value: s.id, label: s.name }))} />
      <${Select} value=${f.owner} onChange=${(/** @type {string} */ v) => nav({ owner: v })} aria-label=${t('admin.filterOwner')} placeholder=${t('admin.anyOwner')}
        options=${(directory.value ?? []).map((u) => ({ value: u.id, label: u.name }))} />
      <${Select} value=${f.promotion} onChange=${(/** @type {string} */ v) => nav({ promotion: v })} aria-label=${t('admin.filterPromotion')} placeholder=${t('admin.anyPromotion')}
        options=${['pending', 'promoted', 'skipped'].map((x) => ({ value: x, label: t(`entry.promo_${x}`) }))} />`;
  const activeFilters = ['to', 'type', 'space', 'owner', 'promotion'].filter((k) => f[k]).length + (f.from ? 1 : 0);
  const csvHref = `/api/v1/admin/entries.csv?${new URLSearchParams([...params].filter(([k]) => k !== 'page'))}`;
  return html`<div class="stack audit-page">
    <div class="page-head">
      <h1>${t('admin.entries')}</h1>
      <a class="btn btn--secondary" href=${csvHref} download><${Icon} name="download" />${t('admin.exportCsv')}</a>
      <p class="page-sub">${t('admin.entriesIntro')}</p>
    </div>
    <${SearchField} value=${f.q} onInput=${(/** @type {string} */ v) => nav({ q: v })} placeholder=${t('admin.searchEntries')} class="audit-search" />
    ${isCompact.value
      ? html`<details class="audit-filters-wrap" open=${activeFilters > 0}>
          <summary class="btn btn--secondary btn--sm"><${Icon} name="list-filter" />${t('admin.filters')}${activeFilters > 0 && html`<span class="count count--accent">${activeFilters}</span>`}</summary>
          <div class="audit-filters">${filters}</div>
        </details>`
      : html`<div class="audit-filters">${filters}</div>`}
    ${selected.size > 0 && html`<div class="bulk-bar" role="region" aria-label=${t('admin.bulkActions')}>
      <strong>${t('admin.selectedN', { n: selected.size })}</strong>
      <${Button} size="sm" icon="user-round-cog" onClick=${() => setReassign(rows.filter((/** @type {any} */ r) => selected.has(r.id)))}>${t('entry.reassign')}</${Button}>
      <${Button} size="sm" variant="danger" icon="trash-2" onClick=${bulkDelete}>${t('common.delete')}</${Button}>
      <${Button} size="sm" variant="ghost" onClick=${() => setSelected(new Set())}>${t('admin.clearSelection')}</${Button}>
    </div>`}
    ${data === null
      ? html`<${SkeletonList} rows=${6} />`
      : html`<${DataTable} columns=${columns} rows=${rows} caption=${t('admin.entries')} selectable selected=${selected} onSelect=${setSelected}
          empty=${html`<${EmptyState} icon="clipboard-list" title=${t('admin.noEntries')} text=${t('admin.noEntriesText')} />`} />
        ${data.total > 0 && html`<nav class="pager" aria-label=${t('admin.pages')}>
          <span class="small muted">${t('admin.totalEntries', { n: data.total })}</span>
          <${Button} size="sm" icon="chevron-left" disabled=${data.page <= 1} onClick=${() => nav({ page: String(data.page - 1) })}>${t('admin.prevPage')}</${Button}>
          <span class="small num" aria-current="page">${t('admin.pageOf', { page: data.page, pages: data.pages })}</span>
          <${Button} size="sm" iconEnd="chevron-right" disabled=${data.page >= data.pages} onClick=${() => nav({ page: String(data.page + 1) })}>${t('admin.nextPage')}</${Button}>
        </nav>`}`}
    ${reassign && html`<${ReassignDialog} entries=${reassign} onClose=${() => setReassign(null)}
      onDone=${() => (setReassign(null), setSelected(new Set()), load())} />`}
  </div>`;
}
