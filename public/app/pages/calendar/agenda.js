import { html, useEffect, useMemo, useRef } from '../../html.js';
import { t } from '../../i18n/index.js';
import { Button, EmptyState, SkeletonList } from '../../components/ui.js';
import { fmtDateLong, today } from '../../time.js';
import { itemsByDate, matches } from './model.js';
import { AgendaRow } from './grid-views.js';

/**
 * The agenda ("Listă"): sessions grouped by date from today (or earlier with
 * "show past"), loading more as you scroll. Search filters the list.
 * @param {import('./grid-views.js').ViewProps & {from: string, q: string, onMore: () => void}} p
 */
export function AgendaView({ entries, openEntry, newEntry, from, q, loading, onMore }) {
  const visible = useMemo(() => (q ? entries.filter((e) => matches(e, q)) : entries), [entries, q]);
  const byDate = useMemo(() => itemsByDate(visible), [visible]);
  const dates = [...byDate.keys()].filter((d) => d >= from).sort();
  const t0 = today();
  const sentinel = useRef(/** @type {HTMLDivElement|null} */ (null));

  useEffect(() => {
    const el = sentinel.current;
    if (!el || loading) return;
    const io = new IntersectionObserver((list) => list.some((x) => x.isIntersecting) && onMore(), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loading, dates.length]);

  if (loading && !entries.length) return html`<${SkeletonList} rows=${6} />`;
  if (!dates.length) {
    return html`<${EmptyState} icon="calendar-days" title=${q ? t('calendar.noMatches') : t('calendar.agendaEmpty')}
      text=${q ? t('calendar.noMatchesText') : t('calendar.agendaEmptyText')}
      action=${html`<${Button} variant="primary" icon="plus" onClick=${() => newEntry(t0)}>${t('nav.schedule')}</${Button}>`} />`;
  }
  return html`<div class="agenda">
    ${dates.map(
      (d) => html`<section class="agenda-day" aria-labelledby=${`ag-${d}`} data-today=${d === t0 ? 'true' : undefined} data-past=${d < t0 ? 'true' : undefined}>
        <h2 class="agenda-date" id=${`ag-${d}`}>${fmtDateLong(d)}${d === t0 && html` <span class="badge badge--accent">${t('calendar.today')}</span>`}</h2>
        <ul class="day-list" role="list">${(byDate.get(d) ?? []).map((i) => html`<li key=${i.key}><${AgendaRow} item=${i} matchSet=${null} onOpen=${openEntry} /></li>`)}</ul>
      </section>`,
    )}
    <div ref=${sentinel} class="agenda-more"><${Button} variant="ghost" onClick=${onMore}>${t('calendar.loadMore')}</${Button}></div>
  </div>`;
}
