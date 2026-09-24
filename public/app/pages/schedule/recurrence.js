// Section D: recurrence — rule, end, live preview (click a date to skip it).
import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { api } from '../../api.js';
import { Icon, Select } from '../../components/ui.js';
import { addMonths, fmtDayMonth, weekdayNames, weekdayOf } from '../../time.js';
import { nthWeekday, ruleError } from '/shared/rules/recurrence.js';

/**
 * @typedef {{freq: 'weekly'|'monthly_day'|'monthly_weekday', interval: number, weekdays: number[],
 *   end: 'count'|'until', count: number, until: string, exceptions: string[]}} RecurrenceState
 */

/** @param {RecurrenceState} r */
export function toRule(r) {
  /** @type {any} */ const rule = { freq: r.freq };
  if (r.freq === 'weekly') {
    rule.interval = r.interval;
    rule.weekdays = r.weekdays;
  }
  if (r.end === 'count') rule.count = r.count;
  else rule.until = r.until;
  return rule;
}

/** Payload for POST /entries. @param {RecurrenceState|null} r */
export const toRecurrence = (r) => (r ? { rule: toRule(r), exceptions: r.exceptions } : undefined);

/** @param {string} anchor @param {string} freq @returns {RecurrenceState} */
function defaults(anchor, freq) {
  return { freq: /** @type {any} */ (freq), interval: 1, weekdays: [weekdayOf(anchor)], end: 'count', count: 6, until: addMonths(anchor, 3), exceptions: [] };
}

/** @param {{form: import('./model.js').FormState, set: (p: any) => void}} p */
export function RecurrenceSection({ form, set }) {
  const anchor = form.sessions[0]?.date;
  /** @type {RecurrenceState|null} */
  const r = form.recurrence;
  const [preview, setPreview] = useState(/** @type {any} */ (null));
  const wd = weekdayNames('short');
  const nth = anchor ? nthWeekday(anchor) : null;

  /** @param {Partial<RecurrenceState>} patch */
  const upd = (patch) => set({ recurrence: { .../** @type {RecurrenceState} */ (r), ...patch } });

  // Live preview of the dates, with conflicts marked.
  const key = JSON.stringify([r, form.sessions, form.space_id, form.type]);
  useEffect(() => {
    if (!r || !anchor) return setPreview(null);
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await api('POST', '/series/preview', {
          body: {
            type: form.type === 'blocked' ? 'blocked' : 'event',
            rule: toRule(r),
            sessions: form.sessions,
            spaceId: form.space_id || null,
            exceptions: r.exceptions,
          },
          signal: ctrl.signal,
        });
        setPreview(res);
      } catch {
        /* keep the last preview */
      }
    }, 300);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [key]);

  if (!anchor) return null;
  const localError = r ? ruleError(toRule(r), anchor) : null;
  const dates = preview?.dates ?? [];
  const active = dates.filter((/** @type {any} */ d) => !d.skipped);

  return html`<div class="stack">
    <div class="field">
      <label for="f-recurrence">${t('recurrence.repeats')}</label>
      <${Select} id="f-recurrence" value=${r?.freq ?? ''} onChange=${(/** @type {string} */ v) => set({ recurrence: v ? { ...(r ?? defaults(anchor, v)), freq: v } : null })}
        options=${[
          { value: '', label: t('recurrence.no') },
          { value: 'weekly', label: t('recurrence.weekly') },
          { value: 'monthly_day', label: t('recurrence.monthlyDay', { day: Number(anchor.slice(8)) }) },
          { value: 'monthly_weekday', label: t('recurrence.monthlyWeekday', { n: nth?.n === 5 ? 'last' : String(nth?.n), weekday: weekdayNames('long')[(nth?.weekday ?? 1) - 1] }) },
        ]} />
    </div>
    ${r && html`
      ${r.freq === 'weekly' && html`<div class="stack" style=${{ '--stack-gap': 'var(--space-3)' }}>
        <label class="inline-field">${t('recurrence.every')}
          <input class="input num" type="number" min="1" max="12" value=${r.interval} aria-label=${t('recurrence.intervalWeeks')}
            onInput=${(/** @type {any} */ e) => upd({ interval: Math.max(1, Math.min(12, Number(e.currentTarget.value) || 1)) })} />
          ${t('recurrence.weeksOn', { n: r.interval })}</label>
        <div class="weekday-toggles" role="group" aria-label=${t('recurrence.weekdays')}>
          ${wd.map((name, i) => {
            const day = i + 1;
            const on = r.weekdays.includes(day);
            const fixed = day === weekdayOf(anchor);
            return html`<button type="button" class="chip" aria-pressed=${on ? 'true' : 'false'} disabled=${fixed}
              title=${fixed ? t('recurrence.anchorDay') : undefined}
              onClick=${() => upd({ weekdays: on ? r.weekdays.filter((x) => x !== day) : [...r.weekdays, day].sort() })}>${name}</button>`;
          })}
        </div>
      </div>`}
      <fieldset class="radio-inline">
        <legend class="field-label">${t('recurrence.ends')}</legend>
        <label class="check"><input type="radio" name="rec-end" checked=${r.end === 'count'} onChange=${() => upd({ end: 'count' })} />
          <span class="inline-field">${t('recurrence.after')}
            <input class="input num" type="number" min="2" max="52" value=${r.count} disabled=${r.end !== 'count'} aria-label=${t('recurrence.occurrences')}
              onInput=${(/** @type {any} */ e) => upd({ count: Number(e.currentTarget.value) || 2 })} />${t('recurrence.occurrencesWord')}</span></label>
        <label class="check"><input type="radio" name="rec-end" checked=${r.end === 'until'} onChange=${() => upd({ end: 'until' })} />
          <span class="inline-field">${t('recurrence.until')}
            <input class="input" type="date" value=${r.until} min=${anchor} max=${addMonths(anchor, 12)} disabled=${r.end !== 'until'} aria-label=${t('recurrence.untilDate')}
              onChange=${(/** @type {any} */ e) => e.currentTarget.value && upd({ until: e.currentTarget.value })} /></span></label>
      </fieldset>
      ${localError && html`<div class="field-error"><${Icon} name="circle-alert" />${t(`errors.${localError}`)}</div>`}
      ${!localError && dates.length > 0 && html`<div class="stack" style=${{ '--stack-gap': 'var(--space-2)' }}>
        <p class="small strong" aria-live="polite">${t('recurrence.previewSummary', {
          n: active.length,
          list: active.length > 4 ? `${active.slice(0, 3).map((/** @type {any} */ d) => fmtDayMonth(d.date)).join(', ')}, … ${fmtDayMonth(active.at(-1).date)}` : active.map((/** @type {any} */ d) => fmtDayMonth(d.date)).join(', '),
        })}</p>
        <p class="xs muted">${t('recurrence.skipHint')}</p>
        <ul class="occurrence-list" role="list">
          ${dates.map(
            (/** @type {any} */ d, /** @type {number} */ i) => html`<li><button type="button" class="chip occurrence" aria-pressed=${d.skipped ? 'false' : 'true'}
              data-conflict=${d.conflict && !d.skipped ? 'true' : undefined} data-skipped=${d.skipped ? 'true' : undefined} disabled=${i === 0}
              title=${d.conflict ? d.conflicts.map((/** @type {any} */ c) => `${c.title ?? t('entry.roomBooking')} · ${c.owner}`).join('\n') : undefined}
              aria-label=${`${fmtDayMonth(d.date)}${d.conflict ? `, ${t('recurrence.conflict')}` : ''}${d.skipped ? `, ${t('recurrence.skipped')}` : ''}`}
              onClick=${() => upd({ exceptions: d.skipped ? r.exceptions.filter((x) => x !== d.date) : [...r.exceptions, d.date] })}>
              ${d.conflict && !d.skipped && html`<${Icon} name="triangle-alert" />`}${fmtDayMonth(d.date)}</button></li>`,
          )}
        </ul>
        ${active.some((/** @type {any} */ d) => d.conflict) && html`<p class="small text-danger"><${Icon} name="circle-alert" /> ${t('recurrence.conflictsHint')}</p>`}
      </div>`}
    `}
  </div>`;
}

/** "6 sesiuni lunare" for the summary bar. @param {import('./model.js').FormState} f */
export function recurrenceSummary(f) {
  const r = /** @type {RecurrenceState|null} */ (f.recurrence);
  if (!r) return '';
  const n = r.end === 'count' ? r.count - r.exceptions.length : null;
  const kind = r.freq === 'weekly' ? t('recurrence.kindWeekly') : t('recurrence.kindMonthly');
  return n ? t('recurrence.summaryCount', { n, kind }) : t('recurrence.summaryUntil', { kind, date: fmtDayMonth(r.until) });
}
