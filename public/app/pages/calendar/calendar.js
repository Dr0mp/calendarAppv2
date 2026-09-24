import { useLocation } from 'preact-iso';
import { html, useEffect, useMemo, useRef, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { user } from '../../state/session.js';
import { store } from '../../state/prefs.js';
import { usePageChrome } from '../../state/chrome.js';
import { fetchEntries, revision, clearEntryCache } from '../../state/entries.js';
import { loadVenues } from '../../state/venues.js';
import { Button, IconButton, SearchField, Segmented, Alert } from '../../components/ui.js';
import { isCompact } from '../../components/media-query.js';
import { addDays, fmtDate, fmtDateLong, fmtDayMonth, fmtMonthYear, isPastSlot, startOfWeek, today } from '../../time.js';
import { VIEWS, anchorDate, dateParam, rangeFor, step, applyFilters, fold, matches } from './model.js';
import { FilterPopover, FilterChips } from './filters.js';
import { YearView, MonthView } from './grid-views.js';
import { TimeGrid } from './timegrid.js';
import { AgendaView } from './agenda.js';
import { Modal } from '../../components/overlay.js';
import { lazy } from 'preact-iso';

const SchedulePage = lazy(() => import('../schedule/schedule.js'));

/** @param {string} v */
const list = (v) => (v ? v.split(',').filter(Boolean) : []);

export default function Calendar() {
  const { query, path, route } = useLocation();
  const compact = isCompact.value;
  const me = /** @type {any} */ (user.value);
  const t0 = today();

  // View: URL, else the remembered zoom, else Day on phones / Month on desktop.
  const remembered = store.get('calendar.view');
  let view = VIEWS.includes(query.view) ? query.view : VIEWS.includes(remembered) ? remembered : compact ? 'day' : 'month';
  if (view === 'week' && compact) view = 'day';
  const anchor = anchorDate(view, query.date, t0);
  const filters = { types: list(query.type), spaces: list(query.space), owner: query.owner ?? '' };
  const q = query.q ?? '';

  usePageChrome(t('nav.calendar'), html`<a class="btn btn--primary btn--sm" href=${`/schedule`}><svg class="icon" aria-hidden="true"><use href="/icons.svg#i-plus"></use></svg>${t('nav.schedule')}</a>`);

  useEffect(() => {
    store.set('calendar.view', view);
  }, [view]);

  /**
   * Update the URL (push for navigation, replace for typing).
   * @param {Record<string, string|null|undefined>} patch @param {boolean} [replace]
   */
  const nav = (patch, replace = false) => {
    const u = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') u.delete(k);
      else u.set(k, v);
    }
    const s = u.toString();
    route(`${path}${s ? `?${s}` : ''}`, replace);
  };
  /**
   * Switch view. Without an explicit date, keep today when it lies in the
   * visible period, otherwise the period's anchor.
   * @param {string} v @param {string} [d]
   */
  const goView = (v, d) => nav({ view: v, date: dateParam(v, d ?? focusDate(view, anchor)) });
  /** @param {string} d */
  const goDate = (d) => nav({ view, date: dateParam(view, d) });
  /** @param {string} id */
  const openEntry = (id) => nav({ entry: id });
  // Desktop quick-create: the scheduling form in a side panel over the calendar.
  const [quick, setQuick] = useState(/** @type {{date: string, time?: string, space?: string}|null} */ (null));
  /** @param {string} date @param {string} [time] */
  const newEntry = (date, time) => {
    if (isPastSlot(date, time ?? '23:00')) return;
    const space = filters.spaces.length === 1 ? filters.spaces[0] : undefined;
    if (!compact) return setQuick({ date, time, space });
    const params = new URLSearchParams({ date });
    if (time) params.set('time', time);
    if (space) params.set('space', space);
    route(`/schedule?${params}`);
  };

  // ---- Data -------------------------------------------------------------
  const range = rangeFor(view, view === 'agenda' ? (query.past ? addDays(t0, -90) : t0) : anchor);
  const [agendaDays, setAgendaDays] = useState(60);
  const fetchRange = view === 'agenda' ? { from: range.from, to: addDays(range.from, agendaDays - 1 + (query.past ? 90 : 0)) } : range;
  const [entries, setEntries] = useState(/** @type {any[]|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [tick, setTick] = useState(0);
  const loadKey = `${fetchRange.from}|${fetchRange.to}|${revision.value}|${tick}`;

  useEffect(() => {
    loadVenues();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    fetchEntries({ from: fetchRange.from, to: fetchRange.to }, { signal: ctrl.signal })
      .then(setEntries)
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(err?.text ?? t('errors.generic'));
      });
    return () => ctrl.abort();
  }, [loadKey]);

  // Staying fresh: refetch on focus (at most every 30 s) and every 5 min while visible.
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 30_000) return;
      last = Date.now();
      clearEntryCache();
      setTick((x) => x + 1);
    };
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        last = 0;
        refresh();
      }
    }, 5 * 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const filtered = useMemo(() => applyFilters(entries ?? [], filters, me.id), [entries, query.type, query.space, query.owner]);
  const qf = fold(q.trim());
  const matchSet = useMemo(() => (qf ? new Set(filtered.filter((e) => matches(e, qf)).map((e) => e.id)) : null), [filtered, qf]);

  // ---- Keyboard shortcuts (desktop) -------------------------------------
  const keyState = useRef({ view, anchor });
  keyState.current = { view, anchor };
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      const el = /** @type {HTMLElement} */ (e.target);
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return;
      if (document.querySelector('dialog[open]')) return;
      const { view: v, anchor: a } = keyState.current;
      const map = { y: 'year', m: 'month', w: 'week', d: 'day', l: 'agenda' };
      if (e.key === 't') nav({ view: v, date: dateParam(v, today()) });
      else if (e.key === 'n') route('/schedule');
      else if (e.key in map && !(e.key === 'w' && isCompact.value)) {
        const nv = map[/** @type {'y'} */ (e.key)];
        nav({ view: nv, date: dateParam(nv, focusDate(v, a)) });
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !el.closest('[role="grid"]')) {
        nav({ view: v, date: dateParam(v, step(v, a, e.key === 'ArrowLeft' ? -1 : 1)) });
      } else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const label = periodLabel(view, anchor, range);
  const viewOptions = [
    { value: 'year', label: t('calendar.year') },
    { value: 'month', label: t('calendar.month') },
    ...(compact ? [] : [{ value: 'week', label: t('calendar.week') }]),
    { value: 'day', label: t('calendar.day') },
    { value: 'agenda', label: t('calendar.agenda') },
  ];

  const common = { entries: filtered, matchSet, openEntry, newEntry, goView, goDate, anchor };

  return html`<div class="calendar" data-view=${view}>
    <div class="cal-head">
      <div class="cal-nav">
        <${IconButton} icon="chevron-left" variant="secondary" label=${t('calendar.previous')} onClick=${() => goDate(step(view, anchor, -1))} />
        <${IconButton} icon="chevron-right" variant="secondary" label=${t('calendar.next')} onClick=${() => goDate(step(view, anchor, 1))} />
        <${Button} onClick=${() => goDate(today())}>${t('calendar.today')}</${Button}>
        <h1 class="cal-label" aria-live="polite">${label}</h1>
      </div>
      <div class="cal-tools">
        <${Segmented} label=${t('calendar.view')} value=${view} onChange=${(/** @type {string} */ v) => goView(v)} options=${viewOptions} />
        <${FilterPopover} entries=${entries ?? []} filters=${filters} me=${me.id} onChange=${(/** @type {any} */ f) => nav(f, true)} />
        <${Button} variant="primary" icon="plus" href="/schedule" class="hide-compact">${t('nav.schedule')}</${Button}>
      </div>
    </div>
    <div class="cal-subhead">
      <${SearchField} value=${q} onInput=${(/** @type {string} */ v) => nav({ q: v }, true)} placeholder=${t('calendar.search')} class="cal-search" />
      <${FilterChips} filters=${filters} onChange=${(/** @type {any} */ f) => nav(f, true)} />
      ${view === 'agenda' && html`<label class="switch ms-auto"><input type="checkbox" role="switch" checked=${!!query.past}
        onChange=${(/** @type {any} */ e) => nav({ past: e.currentTarget.checked ? '1' : null }, true)} /><span>${t('calendar.showPast')}</span></label>`}
      ${matchSet && html`<span class="small muted" aria-live="polite">${t('calendar.matches', { n: matchSet.size })}</span>`}
    </div>
    ${error && html`<${Alert} tone="danger">${error}</${Alert}>`}
    <div class="cal-body" aria-busy=${entries === null ? 'true' : 'false'}>
      ${view === 'year' && html`<${YearView} ...${common} loading=${entries === null} />`}
      ${view === 'month' && html`<${MonthView} ...${common} loading=${entries === null} />`}
      ${(view === 'week' || view === 'day') && html`<${TimeGrid} ...${common} days=${view === 'week' ? weekDays(anchor) : [anchor]} loading=${entries === null} />`}
      ${view === 'agenda' && html`<${AgendaView} ...${common} from=${range.from} loading=${entries === null} q=${qf}
        onMore=${() => setAgendaDays((n) => n + 60)} />`}
    </div>
    ${quick && html`<${Modal} open kind="panel" size="wide" onClose=${() => setQuick(null)} title=${t('schedule.title')} class="quick-panel">
      <${SchedulePage} embedded=${{
        ...quick,
        onClose: () => setQuick(null),
        onSaved: (/** @type {any} */ e) => {
          setQuick(null);
          nav({ entry: e.id });
        },
      }} />
    </${Modal}>`}
  </div>`;
}

/** Today if it's in the visible period of `view`, else the anchor. @param {string} view @param {string} anchor */
function focusDate(view, anchor) {
  const t0 = today();
  const r = rangeFor(view, anchor);
  const inPeriod = view === 'month' ? t0.slice(0, 7) === anchor.slice(0, 7) : t0 >= r.from && t0 <= r.to;
  return inPeriod ? t0 : view === 'week' ? startOfWeek(anchor) : anchor;
}

/** @param {string} d */
function weekDays(d) {
  const s = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/** @param {string} view @param {string} d @param {{from: string, to: string}} r */
function periodLabel(view, d, r) {
  if (view === 'year') return d.slice(0, 4);
  if (view === 'month') return capital(fmtMonthYear(d.slice(0, 7)));
  if (view === 'week') {
    const s = startOfWeek(d);
    const e = addDays(s, 6);
    return s.slice(0, 7) === e.slice(0, 7) ? `${Number(s.slice(8))}–${fmtDate(e)}` : `${fmtDayMonth(s)} – ${fmtDate(e)}`;
  }
  if (view === 'day') return capital(fmtDateLong(d));
  return t('calendar.fromDate', { date: fmtDate(r.from) });
}

/** @param {string} s */
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
