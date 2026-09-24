import { html, useEffect, useMemo, useRef, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { Icon, Skeleton } from '../../components/ui.js';
import { Modal, Popover } from '../../components/overlay.js';
import { isCompact } from '../../components/media-query.js';
import { addDays, fmtDateLong, fmtMonth, monthGrid, today, weekdayNames, weekdayOf, isPastSlot } from '../../time.js';
import { itemsByDate, countInMonth } from './model.js';
import { entryTitle } from '../entry/detail.js';

export const TYPE_ICON = { event: 'ticket', blocked: 'lock', room_only: 'bed' };

/** Roving focus across dates: arrows ±1 day / ±1 week, Home/End row, Enter opens. */
function useRovingDate(initial) {
  const [focus, setFocus] = useState(initial);
  const root = useRef(/** @type {HTMLElement|null} */ (null));
  useEffect(() => setFocus(initial), [initial]);
  /** @param {KeyboardEvent} e @param {(d: string) => void} onEnter */
  const onKeyDown = (e, onEnter) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      const next = addDays(focus, moves[/** @type {'ArrowLeft'} */ (e.key)]);
      setFocus(next);
      requestAnimationFrame(() => /** @type {HTMLElement|null} */ (root.current?.querySelector(`[data-date="${next}"]`))?.focus());
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = addDays(focus, e.key === 'Home' ? 1 - weekdayOf(focus) : 7 - weekdayOf(focus));
      setFocus(next);
      requestAnimationFrame(() => /** @type {HTMLElement|null} */ (root.current?.querySelector(`[data-date="${next}"]`))?.focus());
    } else if (e.key === 'Enter' && /** @type {HTMLElement} */ (e.target).dataset.date) {
      e.preventDefault();
      onEnter(focus);
    }
  };
  return { focus, setFocus, root, onKeyDown };
}

/**
 * @typedef {{entries: any[], matchSet: Set<string>|null, openEntry: (id: string) => void, newEntry: (d: string, time?: string) => void,
 *   goView: (v: string, d?: string) => void, goDate: (d: string) => void, anchor: string, loading: boolean}} ViewProps
 */

/** @param {ViewProps} p */
export function YearView({ entries, matchSet, goView, anchor, loading }) {
  const year = anchor.slice(0, 4);
  const byDate = useMemo(() => itemsByDate(entries), [entries]);
  const t0 = today();
  const wd = weekdayNames('narrow');
  const initial = anchor.slice(0, 4) === t0.slice(0, 4) ? t0 : `${year}-01-01`;
  const { focus, setFocus, root, onKeyDown } = useRovingDate(initial);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

  return html`<div class="year-grid" ref=${root} onKeyDown=${(/** @type {KeyboardEvent} */ e) => onKeyDown(e, (d) => goView('day', d))}>
    ${months.map((ym) => {
      const grid = monthGrid(ym);
      const n = countInMonth(entries, ym);
      return html`<section class="mini-month card" aria-labelledby=${`mm-${ym}`}>
        <header class="mini-head">
          <button type="button" class="mini-title" id=${`mm-${ym}`} onClick=${() => goView('month', `${ym}-01`)}>${fmtMonth(ym)}</button>
          ${loading ? html`<${Skeleton} w="24px" h="18px" />` : html`<span class=${`count ${n ? 'count--accent' : ''}`} title=${t('calendar.entriesInMonth', { n })}>${n}</span>`}
        </header>
        <div role="grid" aria-labelledby=${`mm-${ym}`} class="mini-grid">
          <div role="row" class="mini-row">${wd.map((d) => html`<span role="columnheader" class="mini-wd">${d}</span>`)}</div>
          ${Array.from({ length: 6 }, (_, r) => grid.slice(r * 7, r * 7 + 7)).filter((week) => week.some((d) => d.slice(0, 7) === ym)).map((week) => html`<div role="row" class="mini-row">
            ${week.map((d) => {
              const inMonth = d.slice(0, 7) === ym;
              if (!inMonth) return html`<span role="gridcell" class="mini-day is-out"></span>`;
              const items = byDate.get(d) ?? [];
              const types = [...new Set(items.map((i) => i.entry.type))].slice(0, 3);
              const hit = matchSet && items.some((i) => matchSet.has(i.entry.id));
              const tip = items.map((i) => `${i.start ? `${i.start} ` : ''}${entryTitle(i.entry)}`).join('\n');
              return html`<button type="button" role="gridcell" class="mini-day" data-date=${d} tabindex=${d === focus ? 0 : -1}
                data-today=${d === t0 ? 'true' : undefined} data-past=${d < t0 ? 'true' : undefined} data-dim=${matchSet && !hit ? 'true' : undefined}
                title=${tip || undefined} aria-label=${`${fmtDateLong(d)}${items.length ? `, ${t('calendar.nEntries', { n: items.length })}` : ''}`}
                onFocus=${() => setFocus(d)} onClick=${() => goView('day', d)}>
                <span class="num">${Number(d.slice(8))}</span>
                ${types.length > 0 && html`<span class="mini-dots" aria-hidden="true">${types.map((ty) => html`<i data-type=${ty}></i>`)}</span>`}
              </button>`;
            })}
          </div>`)}
        </div>
      </section>`;
    })}
  </div>`;
}

/** @param {ViewProps} p */
export function MonthView({ entries, matchSet, openEntry, newEntry, goView, anchor, loading }) {
  const ym = anchor.slice(0, 7);
  const grid = monthGrid(ym);
  const byDate = useMemo(() => itemsByDate(entries), [entries]);
  const t0 = today();
  const compact = isCompact.value;
  const wd = weekdayNames(compact ? 'narrow' : 'short');
  const initial = ym === t0.slice(0, 7) ? t0 : `${ym}-01`;
  const { focus, setFocus, root, onKeyDown } = useRovingDate(initial);
  const [sheet, setSheet] = useState(/** @type {string|null} */ (null));
  const openDay = (/** @type {string} */ d) => (compact ? setSheet(d) : goView('day', d));

  return html`<div class=${`month ${compact ? 'month--compact' : ''}`} role="grid" aria-label=${fmtMonth(ym)} ref=${root}
    onKeyDown=${(/** @type {KeyboardEvent} */ e) => onKeyDown(e, openDay)}>
    <div role="row" class="month-head">${wd.map((d, i) => html`<div role="columnheader" class="month-wd" data-weekend=${i >= 5 ? 'true' : undefined}>${d}</div>`)}</div>
    ${Array.from({ length: 6 }, (_, r) => html`<div role="row" class="month-row">
      ${grid.slice(r * 7, r * 7 + 7).map((d, c) => {
        const items = byDate.get(d) ?? [];
        const past = d < t0;
        const future = !isPastSlot(d, '23:00');
        const visible = compact ? items.slice(0, 3) : items.slice(0, 3);
        const more = items.length - visible.length;
        return html`<div role="gridcell" class="mday" data-date=${d} tabindex=${d === focus ? 0 : -1}
          data-out=${d.slice(0, 7) !== ym ? 'true' : undefined} data-weekend=${c >= 5 ? 'true' : undefined}
          data-past=${past ? 'true' : undefined} data-today=${d === t0 ? 'true' : undefined}
          aria-label=${`${fmtDateLong(d)}${items.length ? `, ${t('calendar.nEntries', { n: items.length })}` : ''}`}
          onFocus=${(/** @type {FocusEvent} */ e) => e.target === e.currentTarget && setFocus(d)}
          onClick=${(/** @type {MouseEvent} */ e) => {
            const el = /** @type {HTMLElement} */ (e.target);
            if (compact || el === e.currentTarget || el.classList.contains('mday-fill')) openDay(d);
          }}>
          <div class="mday-top">
            <button type="button" class="mday-num num" tabindex="-1" onClick=${(/** @type {Event} */ e) => (e.stopPropagation(), openDay(d))}
              aria-label=${t('calendar.openDay', { date: fmtDateLong(d) })}>${Number(d.slice(8))}</button>
            ${!compact && future && html`<button type="button" class="mday-add" tabindex="-1" aria-label=${t('calendar.scheduleOn', { date: fmtDateLong(d) })}
              onClick=${(/** @type {Event} */ e) => (e.stopPropagation(), newEntry(d))}><${Icon} name="plus" /></button>`}
          </div>
          ${loading
            ? null
            : compact
              ? html`<div class="mday-bars" aria-hidden="true">${visible.map((i) => html`<i data-type=${i.entry.type} style=${{ '--owner': `var(--${i.entry.owner.color})` }}
                  data-dim=${matchSet && !matchSet.has(i.entry.id) ? 'true' : undefined}></i>`)}</div>`
              : html`<div class="mday-items">
                  ${visible.map((i) => html`<${EntryChip} item=${i} matchSet=${matchSet} onOpen=${openEntry} />`)}
                  ${more > 0 && html`<${Popover} label=${fmtDateLong(d)} trigger=${(/** @type {any} */ p) => html`<button type="button" class="mday-more" ref=${p.ref}
                    onClick=${(/** @type {Event} */ e) => (e.stopPropagation(), p.toggle())} aria-expanded=${p['aria-expanded']}>${t('calendar.nMore', { n: more })}</button>`}>
                    ${() => html`<div class="day-pop stack" style=${{ '--stack-gap': 'var(--space-1)' }}>
                      <strong class="small">${fmtDateLong(d)}</strong>
                      ${items.map((i) => html`<${EntryChip} item=${i} matchSet=${matchSet} onOpen=${openEntry} />`)}
                    </div>`}
                  </${Popover}>`}
                  <span class="mday-fill" aria-hidden="true"></span>
                </div>`}
        </div>`;
      })}
    </div>`)}
    ${compact && html`<${DaySheet} date=${sheet} items=${sheet ? byDate.get(sheet) ?? [] : []} matchSet=${matchSet} onClose=${() => setSheet(null)}
      openEntry=${(/** @type {string} */ id) => (setSheet(null), openEntry(id))} newEntry=${newEntry} />`}
  </div>`;
}

/**
 * A calendar chip: thin owner accent, tinted background, type icon (and a
 * hatch for blocked slots), time and title.
 * @param {{item: import('./model.js').DayItem, matchSet: Set<string>|null, onOpen: (id: string) => void, showTime?: boolean}} p
 */
export function EntryChip({ item, matchSet, onOpen, showTime = true }) {
  const e = item.entry;
  const dim = matchSet && !matchSet.has(e.id);
  const hit = matchSet && matchSet.has(e.id);
  return html`<button type="button" class="entry-chip" data-type=${e.type} data-dim=${dim ? 'true' : undefined} data-hit=${hit ? 'true' : undefined}
    style=${{ '--owner': `var(--${e.owner.color})` }} onClick=${(/** @type {Event} */ ev) => (ev.stopPropagation(), onOpen(e.id))}
    title=${`${item.start ? `${item.start}–${item.end} · ` : ''}${entryTitle(e)} · ${e.owner.name}`}>
    <${Icon} name=${TYPE_ICON[/** @type {'event'} */ (e.type)]} />
    ${showTime && item.start && html`<span class="chip-time num">${item.start}</span>`}
    <span class="chip-title">${entryTitle(e)}</span>
  </button>`;
}

/**
 * Phone: the day's agenda in a bottom sheet, with "Schedule on this day".
 * @param {{date: string|null, items: import('./model.js').DayItem[], matchSet: Set<string>|null, onClose: () => void,
 *   openEntry: (id: string) => void, newEntry: (d: string) => void}} p
 */
export function DaySheet({ date, items, matchSet, onClose, openEntry, newEntry }) {
  const canAdd = date && !isPastSlot(date, '23:00');
  return html`<${Modal} open=${!!date} onClose=${onClose} kind="sheet" title=${date ? fmtDateLong(date) : ''}
    footer=${canAdd && html`<button type="button" class="btn btn--primary btn--block" onClick=${() => (onClose(), newEntry(/** @type {string} */ (date)))}>
      <${Icon} name="plus" />${t('calendar.scheduleThisDay')}</button>`}>
    ${items.length === 0
      ? html`<p class="muted">${t('calendar.dayEmpty')}</p>`
      : html`<ul class="day-list" role="list">${items.map(
          (i) => html`<li><${AgendaRow} item=${i} matchSet=${matchSet} onOpen=${openEntry} /></li>`,
        )}</ul>`}
  </${Modal}>`;
}

/**
 * One agenda row: time (or "all day" for stays), type icon, title, owner and place.
 * @param {{item: import('./model.js').DayItem, matchSet: Set<string>|null, onOpen: (id: string) => void}} p
 */
export function AgendaRow({ item, matchSet, onOpen }) {
  const e = item.entry;
  const where = e.type === 'room_only' ? e.room_bookings.map((/** @type {any} */ b) => b.room_name).join(', ') : e.space?.name ?? (e.type === 'blocked' ? t('schedule.wholeVenue') : '');
  return html`<button type="button" class="agenda-row" data-type=${e.type} data-dim=${matchSet && !matchSet.has(e.id) ? 'true' : undefined}
    style=${{ '--owner': `var(--${e.owner.color})` }} onClick=${() => onOpen(e.id)}>
    <span class="agenda-time num">${item.start ? html`${item.start}<span class="muted">${item.end}</span>` : t('calendar.allDay')}</span>
    <span class="agenda-main">
      <span class="agenda-title"><${Icon} name=${TYPE_ICON[/** @type {'event'} */ (e.type)]} />${entryTitle(e)}</span>
      <span class="agenda-meta small muted">${[e.owner.name, where].filter(Boolean).join(' · ')}</span>
    </span>
  </button>`;
}
