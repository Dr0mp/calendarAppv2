import { html } from '../../html.js';
import { t } from '../../i18n/index.js';
import { Alert, Button, Icon, IconButton } from '../../components/ui.js';
import { rooms as roomList } from '../../state/venues.js';
import { addDays, fmtDayMonth } from '../../time.js';
import { findRoomConflicts } from '/shared/rules/conflicts.js';

/**
 * Section E: accommodation rows (staff only).
 * @param {{form: import('./model.js').FormState, set: (p: Partial<import('./model.js').FormState>) => void,
 *   errors: Record<string,string>, avail: any, defaultDate: string}} p
 */
export function RoomRows({ form, set, errors, avail, defaultDate }) {
  const bookings = form.room_bookings;
  const enabled = (roomList.value ?? []).filter((r) => r.enabled || bookings.some((b) => b.room_id === r.id));
  const internal = findRoomConflicts(/** @type {any} */ (bookings), []);
  const serverConflicts = avail?.roomConflicts ?? [];

  /** @param {number} i @param {Partial<import('./model.js').Booking>} patch */
  const update = (i, patch) => {
    const next = bookings.map((b, j) => (j === i ? { ...b, ...patch } : b));
    // Keep check-out after check-in.
    const b = next[i];
    if (patch.check_in && b.check_out <= b.check_in) next[i] = { ...b, check_out: addDays(b.check_in, 1) };
    set({ room_bookings: next });
  };

  function add() {
    const used = new Set(bookings.map((b) => b.room_id));
    const room = enabled.find((r) => !used.has(r.id) && r.enabled) ?? enabled[0];
    const inDate = bookings.at(-1)?.check_in ?? defaultDate;
    set({ room_bookings: [...bookings, { room_id: room?.id ?? '', check_in: inDate, check_out: addDays(inDate, 1), guests: 1, guest_names: '' }] });
  }

  /** @param {number} i */
  function remove(i) {
    if (form.type === 'room_only' && bookings.length === 1) return;
    set({ room_bookings: bookings.filter((_, j) => j !== i) });
  }

  /**
   * A conflict for row `b`: from the server (another entry's booking) or
   * between rows of this form. Normalised to {id, title, check_in, check_out}.
   * @param {number} _i @param {any} b
   */
  const conflictFor = (_i, b) => {
    const s = serverConflicts.find((/** @type {any} */ c) => c.booking.room_id === b.room_id && c.booking.check_in === b.check_in && c.booking.check_out === b.check_out);
    if (s) return { id: s.id, title: s.title, check_in: s.check_in, check_out: s.check_out };
    const own = internal.find((c) => c.booking === b || (c.room_id === b.room_id && c.check_in === b.check_in && c.check_out === b.check_out && c.booking !== b));
    return own ? { id: null, title: null, check_in: own.check_in, check_out: own.check_out } : null;
  };

  return html`<div class="stack">
    ${bookings.length === 0 && html`<p class="small muted">${t('schedule.noRooms')}</p>`}
    ${bookings.map((b, i) => {
      const room = enabled.find((r) => r.id === b.room_id);
      const over = room && Number(b.guests) > room.capacity_guests;
      const conflict = conflictFor(i, b);
      return html`<fieldset class="room-row" data-invalid=${conflict ? 'true' : undefined}>
        <legend class="sr-only">${t('schedule.roomN', { n: i + 1 })}</legend>
        <div class="room-grid">
          <label class="room-select"><span class="field-label">${t('schedule.room')}</span>
            <select id=${`f-room_bookings-${i}-room_id`} class="select" value=${b.room_id} onChange=${(/** @type {any} */ e) => update(i, { room_id: e.currentTarget.value })}>
              ${enabled.map(
                (r) => html`<option value=${r.id} selected=${r.id === b.room_id}>
                  ${[r.name, r.room_type, t('common.guests', { n: r.capacity_guests })].filter(Boolean).join(' · ')}</option>`,
              )}
            </select>
          </label>
          <label><span class="field-label">${t('schedule.checkIn')}</span>
            <input id=${`f-room_bookings-${i}-check_in`} class="input" type="date" value=${b.check_in}
              onChange=${(/** @type {any} */ e) => e.currentTarget.value && update(i, { check_in: e.currentTarget.value })} /></label>
          <label><span class="field-label">${t('schedule.checkOut')}</span>
            <input id=${`f-room_bookings-${i}-check_out`} class="input" type="date" value=${b.check_out} min=${addDays(b.check_in, 1)}
              aria-invalid=${errors[`room_bookings.${i}.check_out`] ? 'true' : undefined}
              onChange=${(/** @type {any} */ e) => e.currentTarget.value && update(i, { check_out: e.currentTarget.value })} /></label>
          <label class="room-guests"><span class="field-label">${t('schedule.guests')}</span>
            <input id=${`f-room_bookings-${i}-guests`} class="input" type="number" min="1" max="50" inputMode="numeric" value=${b.guests}
              onInput=${(/** @type {any} */ e) => update(i, { guests: Number(e.currentTarget.value) || 1 })} /></label>
          <label class="room-names"><span class="field-label">${t('schedule.guestNames')}</span>
            <input class="input" value=${b.guest_names} placeholder=${t('common.optional')} onInput=${(/** @type {any} */ e) => update(i, { guest_names: e.currentTarget.value })} /></label>
          <div class="room-remove">
            <${IconButton} icon="trash-2" label=${t('schedule.removeRoom', { n: i + 1 })} onClick=${() => remove(i)}
              disabled=${form.type === 'room_only' && bookings.length === 1} title=${form.type === 'room_only' && bookings.length === 1 ? t('schedule.lastRoomHint') : undefined} />
          </div>
        </div>
        <div class="small muted num">${t('schedule.nights', { n: nights(b), from: fmtDayMonth(b.check_in), to: fmtDayMonth(b.check_out) })}</div>
        ${over && html`<div class="field-hint text-warning"><${Icon} name="triangle-alert" /> ${t('schedule.overCapacity', { n: room.capacity_guests })}</div>`}
        ${errors[`room_bookings.${i}.check_out`] && html`<div class="field-error"><${Icon} name="circle-alert" />${t(`errors.${errors[`room_bookings.${i}.check_out`]}`)}</div>`}
        ${conflict &&
        html`<div class="field-error"><${Icon} name="circle-alert" />${conflict.id
          ? t('schedule.roomTaken', { title: conflict.title ?? t('entry.roomBooking'), from: fmtDayMonth(conflict.check_in), to: fmtDayMonth(conflict.check_out) })
          : t('schedule.roomRowsOverlap')}</div>`}
      </fieldset>`;
    })}
    ${form.type === 'room_only' && bookings.length === 1 && html`<p class="xs muted">${t('schedule.lastRoomHint')}</p>`}
    <div><${Button} size="sm" icon="plus" onClick=${add} disabled=${!enabled.length}>${t('schedule.addRoom')}</${Button}></div>
    ${errors.room_bookings && html`<${Alert} tone="danger">${t(`errors.${errors.room_bookings}`)}</${Alert}>`}
  </div>`;
}

/** @param {{check_in: string, check_out: string}} b */
function nights(b) {
  return Math.max(0, Math.round((Date.parse(`${b.check_out}T00:00:00Z`) - Date.parse(`${b.check_in}T00:00:00Z`)) / 86_400_000));
}
