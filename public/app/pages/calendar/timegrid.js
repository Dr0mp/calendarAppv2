import { html, useEffect, useMemo, useRef, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { store } from '../../state/prefs.js';
import { Icon, Switch } from '../../components/ui.js';
import { isCompact } from '../../components/media-query.js';
import { addDays, fmtDateLong, fromMinutes, isPastSlot, now, today, toMinutes, weekdayNames, weekdayOf } from '../../time.js';
import { itemsByDate, layoutColumns } from './model.js';
import { TYPE_ICON, EntryChip } from './grid-views.js';
import { entryTitle } from '../entry/detail.js';

const HOUR_PX = 48;
const SLOT = 30;

/**
 * Week (7 columns) and Day (1 column) views on a time axis. Overlapping
 * sessions sit side by side; a "now" line marks the current time today.
 * @param {import('./grid-views.js').ViewProps & {days: string[]}} p
 */
export function TimeGrid({ entries, matchSet, openEntry, newEntry, goView, goDate, days, loading }) {
  const [fullDay, setFullDayState] = useState(!!store.get('calendar.fullDay'));
  const setFullDay = (/** @type {boolean} */ v) => {
    setFullDayState(v);
    store.set('calendar.fullDay', v);
  };
  const from = fullDay ? 0 : 8 * 60;
  const to = fullDay ? 24 * 60 : 22 * 60;
  const slots = (to - from) / SLOT;
  const byDate = useMemo(() => itemsByDate(entries), [entries]);
  const t0 = today();
  const [nowMin, setNowMin] = useState(now().minutes);
  useEffect(() => {
    const id = setInterval(() => setNowMin(now().minutes), 60_000);
    return () => clearInterval(id);
  }, []);

  // Roving focus over (day, slot).
  const [focus, setFocus] = useState({ d: days.includes(t0) ? t0 : days[0], m: Math.max(from, Math.min(to - SLOT, Math.floor(nowMin / 60) * 60)) });
  useEffect(() => setFocus((f) => ({ d: days.includes(f.d) ? f.d : days[0], m: Math.max(from, Math.min(to - SLOT, f.m)) })), [days.join(), from, to]);
  const root = useRef(/** @type {HTMLDivElement|null} */ (null));
  const scroller = useRef(/** @type {HTMLDivElement|null} */ (null));

  // Start scrolled near the current hour (or 08:00 on the full day).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = fullDay ? (days.includes(t0) ? Math.max(0, nowMin - 90) : 8 * 60) : 0;
    el.scrollTop = ((target - from) / 60) * HOUR_PX;
  }, [fullDay, days[0]]);

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    const di = days.indexOf(focus.d);
    let { d, m } = focus;
    if (e.key === 'ArrowUp') m = Math.max(from, m - SLOT);
    else if (e.key === 'ArrowDown') m = Math.min(to - SLOT, m + SLOT);
    else if (e.key === 'ArrowLeft') {
      if (di > 0) d = days[di - 1];
      else if (days.length === 1) return goDate(addDays(d, -1));
    } else if (e.key === 'ArrowRight') {
      if (di < days.length - 1) d = days[di + 1];
      else if (days.length === 1) return goDate(addDays(d, 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isPastSlot(d, fromMinutes(m))) newEntry(d, fromMinutes(m));
      return;
    } else return;
    e.preventDefault();
    setFocus({ d, m });
    requestAnimationFrame(() => /** @type {HTMLElement|null} */ (root.current?.querySelector(`[data-slot="${d}|${m}"]`))?.focus());
  }

  // Phones: swipe left/right to change day.
  const touch = useRef({ x: 0, y: 0 });
  /** @param {TouchEvent} e */
  const onTouchStart = (e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  /** @param {TouchEvent} e */
  const onTouchEnd = (e) => {
    if (days.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) goDate(addDays(days[0], dx < 0 ? 1 : -1));
  };

  const wd = weekdayNames(isCompact.value ? 'short' : 'short');
  const stays = days.map((d) => (byDate.get(d) ?? []).filter((i) => i.kind === 'stay'));
  const hasStays = stays.some((s) => s.length);

  return html`<div class=${`tg ${days.length === 1 ? 'tg--day' : 'tg--week'}`} style=${{ '--days': days.length, '--hour': `${HOUR_PX}px` }}
    onTouchStart=${onTouchStart} onTouchEnd=${onTouchEnd}>
    <div class="tg-toolbar">
      <${Switch} checked=${fullDay} onChange=${setFullDay} label=${t('calendar.fullDay')} />
    </div>
    <div class="tg-head" aria-hidden=${days.length === 1 ? 'true' : undefined}>
      <span class="tg-corner"></span>
      ${days.map((d) => html`<button type="button" class="tg-dayhead" data-today=${d === t0 ? 'true' : undefined} data-past=${d < t0 ? 'true' : undefined}
        onClick=${() => goView('day', d)} aria-label=${t('calendar.openDay', { date: fmtDateLong(d) })}>
        <span class="tg-wd">${wd[weekdayOf(d) - 1]}</span><span class="tg-dnum num">${Number(d.slice(8))}</span>
      </button>`)}
    </div>
    ${hasStays && html`<div class="tg-allday">
      <span class="tg-corner xs muted">${t('calendar.allDay')}</span>
      ${stays.map((list) => html`<div class="tg-allday-cell">${list.map((i) => html`<${EntryChip} item=${i} matchSet=${matchSet} onOpen=${openEntry} showTime=${false} />`)}</div>`)}
    </div>`}
    <div class="tg-scroll" ref=${scroller}>
      <div class="tg-canvas">
      <div class="tg-body" ref=${root} role="grid" aria-label=${days.length === 1 ? fmtDateLong(days[0]) : t('calendar.week')}
        aria-busy=${loading ? 'true' : 'false'} onKeyDown=${onKey} style=${{ '--slots': slots }}>
        ${Array.from({ length: slots }, (_, r) => {
          const m = from + r * SLOT;
          const time = fromMinutes(m);
          return html`<div role="row" class="tg-row" data-hour=${m % 60 === 0 ? 'true' : undefined}>
            <span role="rowheader" class="tg-time num">${m % 60 === 0 ? time : ''}</span>
            ${days.map((d) => {
              const past = isPastSlot(d, time);
              const focused = focus.d === d && focus.m === m;
              return html`<button type="button" role="gridcell" class="tg-slot" data-slot=${`${d}|${m}`} tabindex=${focused ? 0 : -1}
                aria-disabled=${past ? 'true' : undefined} data-past=${past ? 'true' : undefined}
                aria-label=${past ? t('calendar.slotPast', { date: fmtDateLong(d), time }) : t('calendar.slotNew', { date: fmtDateLong(d), time })}
                onFocus=${() => setFocus({ d, m })} onClick=${() => !past && newEntry(d, time)}></button>`;
            })}
          </div>`;
        })}
      </div>
        <div class="tg-layer">
          <span class="tg-layer-axis"></span>
          ${days.map((d) => {
            const sessions = (byDate.get(d) ?? []).filter((i) => i.kind === 'session');
            const laid = layoutColumns(sessions);
            return html`<div class="tg-col">
              ${laid.map(({ item, col, cols }) => {
                const s = toMinutes(/** @type {string} */ (item.start));
                const e = toMinutes(/** @type {string} */ (item.end));
                const top = Math.max(s, from);
                const bottom = Math.min(e, to);
                if (bottom <= from || top >= to) return null;
                const en = item.entry;
                const dim = matchSet && !matchSet.has(en.id);
                return html`<button type="button" class="tg-block" data-type=${en.type} data-dim=${dim ? 'true' : undefined}
                  data-clip-top=${s < from ? 'true' : undefined} data-clip-bottom=${e > to ? 'true' : undefined}
                  data-short=${bottom - top < 45 ? 'true' : undefined}
                  style=${{
                    '--owner': `var(--${en.owner.color})`,
                    top: `${((top - from) / 60) * HOUR_PX}px`,
                    height: `${Math.max(((bottom - top) / 60) * HOUR_PX - 2, 24)}px`,
                    left: `calc(${(col / cols) * 100}% + 2px)`,
                    width: `calc(${100 / cols}% - 4px)`,
                  }}
                  onClick=${() => openEntry(en.id)}
                  aria-label=${`${item.start}–${item.end}, ${entryTitle(en)}, ${t(`entryType.${en.type}`)}, ${en.owner.name}${en.space ? `, ${en.space.name}` : ''}`}>
                  <span class="tg-block-time num">${item.start}–${item.end}</span>
                  <span class="tg-block-title"><${Icon} name=${TYPE_ICON[/** @type {'event'} */ (en.type)]} />${entryTitle(en)}</span>
                  <span class="tg-block-meta">
                    <span class="avatar avatar--sm" style=${{ '--av': `var(--${en.owner.color})` }} aria-hidden="true">${en.owner.initials}</span>
                    ${en.space ? en.space.name : en.type === 'blocked' ? t('schedule.wholeVenue') : ''}
                  </span>
                </button>`;
              })}
              ${d === t0 && nowMin >= from && nowMin <= to &&
              html`<div class="tg-now" style=${{ top: `${((nowMin - from) / 60) * HOUR_PX}px` }} role="img" aria-label=${t('calendar.now', { time: now().time })}></div>`}
            </div>`;
          })}
        </div>
      </div>
    </div>
    ${!loading && days.length === 1 && !(byDate.get(days[0]) ?? []).length &&
    html`<p class="tg-empty small muted">${t('calendar.dayEmpty')}${!isPastSlot(days[0], '23:00') ? html` <button type="button" class="link-btn" onClick=${() => newEntry(days[0])}>${t('calendar.scheduleThisDay')}</button>` : ''}</p>`}
  </div>`;
}
