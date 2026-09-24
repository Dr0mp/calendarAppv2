import { html, useMemo } from '../../html.js';
import { t } from '../../i18n/index.js';
import { Alert, Button, Checkbox, Icon, IconButton, Segmented, Switch } from '../../components/ui.js';
import { Popover } from '../../components/overlay.js';
import { addDays, fmtDateShort, fmtDuration, fromMinutes, isPastSlot, toMinutes } from '../../time.js';
import { stripCells } from '/shared/rules/availability.js';
import { internalOverlaps } from '/shared/rules/conflicts.js';
import { minutesOf, sortSessions } from './model.js';

/** Times every 15 minutes. `end` lists 00:15–24:00. @param {'start'|'end'} kind */
function timeOptions(kind) {
  const out = [];
  for (let m = kind === 'start' ? 0 : 15; m <= (kind === 'start' ? 23 * 60 + 45 : 24 * 60); m += 15) out.push(fromMinutes(m));
  return out;
}
const START_TIMES = timeOptions('start');
const END_TIMES = timeOptions('end');

/**
 * @param {{value: string, onChange: (v: string) => void, kind: 'start'|'end', id: string, label: string, invalid?: boolean, extra?: string}} p
 */
function TimeSelect({ value, onChange, kind, id, label, invalid, extra }) {
  const list = kind === 'start' ? START_TIMES : END_TIMES;
  const options = list.includes(value) ? list : [...list, value].sort();
  return html`<select id=${id} class="select num time-select" value=${value} aria-label=${label} aria-invalid=${invalid ? 'true' : undefined}
    aria-describedby=${extra} onChange=${(/** @type {any} */ e) => onChange(e.currentTarget.value)}>
    ${options.map((o) => html`<option value=${o} selected=${o === value}>${o}</option>`)}
  </select>`;
}

/**
 * Section C: "Dată și oră".
 * @param {{form: import('./model.js').FormState, set: (patch: Partial<import('./model.js').FormState>) => void,
 *   avail: any, errors: Record<string,string>, fullDay: boolean, setFullDay: (v: boolean) => void, canOverride: boolean,
 *   serverConflict: any, onOverride: (on: boolean) => void}} p
 */
export function DateTimeSection({ form, set, avail, errors, fullDay, setFullDay, canOverride, serverConflict, onOverride }) {
  const { mode, sessions } = form;

  /** @param {number} i @param {Partial<import('./model.js').Session>} patch */
  function updateSession(i, patch) {
    const next = sessions.map((s, j) => {
      if (j !== i) return s;
      const cur = { ...s };
      if (patch.start && patch.start !== s.start) {
        // A new start shifts the end by the same amount (keeps the duration).
        const dur = minutesOf(s);
        const end = Math.min(toMinutes(patch.start) + Math.max(dur, 15), 24 * 60);
        return { ...cur, ...patch, end: fromMinutes(end) };
      }
      return { ...cur, ...patch };
    });
    // In same-day mode every row shares the date.
    const date = patch.date;
    if (mode === 'sameday' && date) set({ sessions: next.map((s) => ({ ...s, date })) });
    else set({ sessions: mode === 'multiday' ? sortSessions(next) : next });
  }

  /** @param {'one'|'sameday'|'multiday'} m */
  function setMode(m) {
    if (m === mode) return;
    const first = sessions[0];
    if (m === 'one') set({ mode: m, sessions: [first] });
    else if (m === 'sameday') set({ mode: m, sessions: sessions.filter((s) => s.date === first.date), recurrence: form.recurrence });
    else set({ mode: m, sessions, recurrence: null });
  }

  function addRow() {
    const last = sessions[sessions.length - 1];
    const dur = minutesOf(last);
    if (mode === 'multiday') {
      set({ sessions: sortSessions([...sessions, { ...last, date: addDays(last.date, 1) }]) });
    } else {
      const start = Math.min(toMinutes(last.end) + 60, 24 * 60 - dur);
      set({ sessions: [...sessions, { date: last.date, start: fromMinutes(start), end: fromMinutes(start + dur) }] });
    }
  }

  const internal = useMemo(() => new Set(internalOverlaps(sessions).flatMap(([a, b]) => [a, b])), [sessions]);
  const conflicts = avail?.conflicts ?? [];
  const conflictKeys = new Set(conflicts.map((/** @type {any} */ c) => `${c.session.date}|${c.session.start}|${c.session.end}`));

  return html`<div class="stack">
    <${Segmented} label=${t('schedule.sessionMode')} value=${mode} onChange=${setMode} block wrap
      options=${[
        { value: 'one', label: t('schedule.modeOne') },
        { value: 'sameday', label: t('schedule.modeSameDay') },
        { value: 'multiday', label: t('schedule.modeMultiDay') },
      ]} />

    <div class="session-rows">
      ${sessions.map((s, i) => {
        const past = isPastSlot(s.date, s.start);
        const bad = internal.has(i) || conflictKeys.has(`${s.date}|${s.start}|${s.end}`);
        const showDate = mode !== 'sameday' || i === 0;
        const err = errors[`sessions.${i}.start`] ?? errors[`sessions.${i}.end`] ?? errors[`sessions.${i}.date`];
        return html`<div class="session-row" data-invalid=${bad || err ? 'true' : undefined} key=${i}>
          <div class="session-fields">
            ${showDate &&
            html`<label class="session-date">
              <span class="field-label">${t('schedule.date')}</span>
              <input id=${`f-sessions-${i}-date`} class="input" type="date" value=${s.date}
                onChange=${(/** @type {any} */ e) => e.currentTarget.value && updateSession(i, { date: e.currentTarget.value })}
                aria-invalid=${errors[`sessions.${i}.date`] ? 'true' : undefined} />
            </label>`}
            <label>
              <span class="field-label">${t('schedule.start')}</span>
              <${TimeSelect} id=${`f-sessions-${i}-start`} kind="start" value=${s.start} label=${t('schedule.start')} invalid=${!!errors[`sessions.${i}.start`]}
                onChange=${(/** @type {string} */ v) => updateSession(i, { start: v })} />
            </label>
            <label>
              <span class="field-label">${t('schedule.end')}</span>
              <${TimeSelect} id=${`f-sessions-${i}-end`} kind="end" value=${s.end} label=${t('schedule.end')} invalid=${!!errors[`sessions.${i}.end`]}
                onChange=${(/** @type {string} */ v) => updateSession(i, { end: v })} />
            </label>
            <span class="session-duration muted small num" aria-live="polite">${minutesOf(s) > 0 ? fmtDuration(minutesOf(s)) : '—'}</span>
            ${sessions.length > 1 &&
            html`<${IconButton} icon="x" size="sm" label=${t('schedule.removeSession', { n: i + 1 })}
              onClick=${() => set({ sessions: sessions.filter((_, j) => j !== i), mode: sessions.length - 1 === 1 ? 'one' : mode })} />`}
          </div>
          ${err && html`<div class="field-error"><${Icon} name="circle-alert" />${t(`errors.${err}`)}</div>`}
          ${internal.has(i) && html`<div class="field-error"><${Icon} name="circle-alert" />${t('errors.sessions_overlap')}</div>`}
          ${past && !err && html`<div class="field-error"><${Icon} name="circle-alert" />${t('errors.in_the_past')}</div>`}
          ${showDate && form.type !== 'room_only' &&
          html`<${AvailabilityStrip} date=${s.date} busy=${avail?.busy?.[s.date] ?? null} selected=${sessions.filter((x) => x.date === s.date)}
            fullDay=${fullDay} onPick=${(/** @type {string} */ start) => {
              // Picking a free hour moves every session of that day by the same offset.
              const delta = toMinutes(start) - toMinutes(s.start);
              set({
                sessions: sessions.map((x) =>
                  x.date === s.date
                    ? { ...x, start: fromMinutes(Math.max(0, toMinutes(x.start) + delta)), end: fromMinutes(Math.min(24 * 60, toMinutes(x.end) + delta)) }
                    : x,
                ),
              });
            }} />`}
        </div>`;
      })}
    </div>

    <div class="cluster">
      ${mode !== 'one' &&
      html`<${Button} size="sm" icon="plus" onClick=${addRow}>${mode === 'multiday' ? t('schedule.addDay') : t('schedule.addInterval')}</${Button}>`}
      <span class="ms-auto"><${Switch} checked=${fullDay} onChange=${setFullDay} label=${t('schedule.fullDay')} /></span>
    </div>

    <${ConflictPanel} avail=${avail} sessions=${sessions} set=${set} canOverride=${canOverride} serverConflict=${serverConflict}
      allowOverlap=${form.allow_overlap} onOverride=${onOverride} />
  </div>`;
}

/**
 * One row per hour for the selected space (all spaces for a blocked slot
 * with no space): free (click to move), busy (tooltip), past, selected.
 * @param {{date: string, busy: any[]|null, selected: import('./model.js').Session[], fullDay: boolean, onPick: (start: string) => void}} p
 */
export function AvailabilityStrip({ date, busy, selected, fullDay, onPick }) {
  const cells = useMemo(() => {
    const all = selected.map((s) => stripCells(date, busy ?? [], s, (d, tm) => isPastSlot(d, tm), fullDay));
    // Merge: a cell is selected if any session covers it.
    return all[0].map((c, i) => all.find((a) => a[i].state === 'selected')?.[i] ?? c);
  }, [date, busy, selected, fullDay]);
  return html`<div class="strip" role="group" aria-label=${t('schedule.availabilityFor', { date: fmtDateShort(date) })} data-loading=${busy === null ? 'true' : undefined}>
    ${cells.map((c) => {
      const who = c.busy.map((/** @type {any} */ e) => `${e.title ?? t('entry.roomBooking')} · ${e.owner}`).join('\n');
      const label =
        c.state === 'busy' ? t('schedule.cellBusy', { time: c.start, who }) :
        c.state === 'past' ? t('schedule.cellPast', { time: c.start }) :
        c.state === 'selected' ? (c.conflict ? t('schedule.cellConflict', { time: c.start, who }) : t('schedule.cellSelected', { time: c.start })) :
        t('schedule.cellFree', { time: c.start });
      return html`<button type="button" class="strip-cell" data-state=${c.state} data-conflict=${c.conflict ? 'true' : undefined}
        disabled=${c.state === 'past' || c.state === 'busy'} title=${label} aria-label=${label}
        onClick=${() => c.state === 'free' && onPick(c.start)}>
        <span class="strip-hour num">${c.start.slice(0, 2)}</span>
      </button>`;
    })}
  </div>`;
}

/**
 * Inline conflict panel next to the date & time section: conflicting
 * entries, up to three suggestions, the admin override, and a calm note
 * about other entries that day.
 * @param {{avail: any, sessions: import('./model.js').Session[], set: (p: any) => void, canOverride: boolean,
 *   allowOverlap: boolean, onOverride: (on: boolean) => void, serverConflict: any}} p
 */
function ConflictPanel({ avail, sessions, set, canOverride, allowOverlap, onOverride, serverConflict }) {
  if (!avail) return null;
  const conflicts = avail.conflicts ?? [];
  const others = Object.values(avail.sameDayOther ?? {}).flat();
  const otherCount = new Set(others.map((/** @type {any} */ o) => o.id)).size;

  /** @param {any} from @param {any} to */
  function use(from, to) {
    set({
      sessions: sessions.map((s) => (s.date === from.date && s.start === from.start && s.end === from.end ? { ...to } : s)),
      allow_overlap: false,
    });
  }

  return html`<div class="stack" style=${{ '--stack-gap': 'var(--space-3)' }} aria-live="polite">
    ${conflicts.length > 0 &&
    html`<div class="conflict-panel" role="alert" id="conflicts">
      <div class="conflict-head"><${Icon} name="triangle-alert" /><strong>${t('schedule.conflictsTitle', { n: conflicts.length })}</strong></div>
      <ul class="conflict-list" role="list">
        ${conflicts.map(
          (/** @type {any} */ c) => html`<li>
            <${Popover} label=${c.title ?? t('entry.roomBooking')} trigger=${(/** @type {any} */ p) => html`<button type="button" class="link-btn" ref=${p.ref}
              onClick=${p.toggle} aria-expanded=${p['aria-expanded']}>${c.kind === 'blocked' ? t('schedule.blockedBy') : ''}${c.title ?? t('entry.roomBooking')}</button>`}>
              ${() => html`<div class="stack" style=${{ '--stack-gap': 'var(--space-1)', padding: 'var(--space-2)' }}>
                <strong>${c.title ?? t('entry.roomBooking')}</strong>
                <span class="small">${fmtDateShort(c.date)} · ${c.start}–${c.end}</span>
                <span class="small muted">${t('entry.createdBy', { name: c.owner })}</span>
                <a class="small" href=${`/entries/${c.id}`} target="_blank" rel="noopener">${t('schedule.openEntry')}</a>
              </div>`}
            </${Popover}>
            <span class="small muted"> · ${fmtDateShort(c.date)}, ${c.start}–${c.end} · ${c.owner}</span>
          </li>`,
        )}
      </ul>
      ${(avail.suggestions ?? []).map(
        (/** @type {any} */ s) => html`<div class="suggestions">
          ${avail.suggestions.length > 1 && html`<div class="small muted">${t('schedule.forSession', { date: fmtDateShort(s.session.date), time: `${s.session.start}–${s.session.end}` })}</div>`}
          ${s.options.length === 0 && html`<p class="small muted">${t('schedule.noSuggestions')}</p>`}
          ${s.options.map(
            (/** @type {any} */ o) => html`<div class="suggestion">
              <${Icon} name="sparkles" />
              <div class="grow"><div class="small strong">${t(`schedule.suggest_${o.kind}`)}</div>
                <div class="small num">${fmtDateShort(o.session.date)} · ${o.session.start}–${o.session.end}</div></div>
              <${Button} size="sm" onClick=${() => use(s.session, o.session)}>${t('schedule.use')}</${Button}>
            </div>`,
          )}
        </div>`,
      )}
      ${canOverride &&
      html`<div class="override">
        <${Checkbox} checked=${allowOverlap} onChange=${onOverride} label=${t('schedule.allowOverlap')} />
        <p class="xs muted">${t('schedule.allowOverlapHint')}</p>
      </div>`}
    </div>`}
    ${conflicts.length === 0 && serverConflict && html`<${Alert} tone="danger">${t('errors.space_conflict')}</${Alert}>`}
    ${otherCount > 0 && html`<${Alert} tone="info">${t('schedule.sameDayOther', { n: otherCount })}</${Alert}>`}
  </div>`;
}
