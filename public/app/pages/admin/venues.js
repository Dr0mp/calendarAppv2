import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { api, ApiError } from '../../api.js';
import { Badge, Button, ColorPicker, EmptyState, Field, IconButton, Input, SkeletonList, Switch, Textarea } from '../../components/ui.js';
import { Modal, confirm } from '../../components/overlay.js';
import { SortableList } from '../../components/sortable.js';
import { toast } from '../../components/toast.js';
import { ROOM_TYPES } from '/shared/rules/validate.js';

export function Spaces() {
  return html`<${VenueAdmin} kind="spaces" />`;
}

export function Rooms() {
  return html`<${VenueAdmin} kind="rooms" />`;
}

/** @param {{kind: 'spaces'|'rooms'}} p */
function VenueAdmin({ kind }) {
  const [items, setItems] = useState(/** @type {any[]|null} */ (null));
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const load = () => api('GET', `/${kind}`).then((r) => setItems(r.items));
  useEffect(() => {
    setItems(null);
    load();
  }, [kind]);

  /** @param {string[]} ids */
  async function reorder(ids) {
    setItems(ids.map((id) => /** @type {any[]} */ (items).find((x) => x.id === id)));
    try {
      const r = await api('POST', `/${kind}/reorder`, { body: { ids } });
      setItems(r.items);
    } catch (err) {
      toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
      load();
    }
  }

  /** @param {any} v */
  async function toggle(v) {
    try {
      await api('PATCH', `/${kind}/${v.id}`, { body: { enabled: !v.enabled }, version: v.version });
      toast('success', v.enabled ? t('admin.venueDisabled', { name: v.name }) : t('admin.venueEnabled', { name: v.name }));
    } catch (err) {
      toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
    }
    load();
  }

  /** @param {any} v */
  async function remove(v) {
    const ok = await confirm({ title: t('admin.deleteVenueTitle', { name: v.name }), message: t('admin.deleteVenueText'), danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    try {
      await api('DELETE', `/${kind}/${v.id}`, { version: v.version });
      toast('success', t('admin.venueDeleted', { name: v.name }));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'in_use') toast('warning', t('admin.venueInUse'));
      else toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
    }
    load();
  }

  const title = kind === 'spaces' ? t('admin.spaces') : t('admin.rooms');
  return html`<div class="stack">
    <div class="page-head">
      <h1>${title}</h1>
      <${Button} variant="primary" icon="plus" onClick=${() => setEditing({})}>
        ${kind === 'spaces' ? t('admin.addSpace') : t('admin.addRoom')}</${Button}>
      <p class="page-sub">${kind === 'spaces' ? t('admin.spacesIntro') : t('admin.roomsIntro')}</p>
    </div>
    ${items === null
      ? html`<${SkeletonList} rows=${3} />`
      : items.length === 0
        ? html`<${EmptyState} icon=${kind === 'spaces' ? 'building-2' : 'bed'} title=${kind === 'spaces' ? t('admin.noSpaces') : t('admin.noRooms')}
            text=${kind === 'spaces' ? t('admin.noSpacesText') : t('admin.noRoomsText')}
            action=${html`<${Button} variant="primary" icon="plus" onClick=${() => setEditing({})}>${kind === 'spaces' ? t('admin.addSpace') : t('admin.addRoom')}</${Button}>`} />`
        : html`<${SortableList} items=${items} onReorder=${reorder} label=${(/** @type {any} */ v) => v.name} class="venue-list"
            render=${(/** @type {any} */ v) => html`<div class="venue-row" data-enabled=${v.enabled ? 'true' : 'false'}>
              <span class="venue-swatch" style=${{ '--swatch': `var(--${v.color})` }} aria-hidden="true"></span>
              <div class="grow">
                <div class="cluster" style=${{ '--cluster-gap': 'var(--space-2)' }}>
                  <strong class="truncate">${v.name}</strong>
                  ${!v.enabled && html`<${Badge}>${t('admin.disabled')}</${Badge}>`}
                </div>
                <div class="small muted">${kind === 'spaces'
                  ? [v.capacity_people != null ? t('common.seats', { n: v.capacity_people }) : null, v.description].filter(Boolean).join(' · ')
                  : [v.room_type, t('common.guests', { n: v.capacity_guests }), v.beds].filter(Boolean).join(' · ')}</div>
              </div>
              <span class="venue-count small muted num" title=${kind === 'spaces' ? t('admin.upcomingEntries') : t('admin.upcomingBookings')}>
                ${kind === 'spaces' ? t('admin.nUpcomingEntries', { n: v.upcoming }) : t('admin.nUpcomingBookings', { n: v.upcoming })}</span>
              <${Switch} checked=${v.enabled} onChange=${() => toggle(v)} label=${html`<span class="sr-only">${t('admin.enabledName', { name: v.name })}</span>`} />
              <${IconButton} icon="pencil" label=${t('common.editName', { name: v.name })} onClick=${() => setEditing(v)} />
              <${IconButton} icon="trash-2" label=${t('common.deleteName', { name: v.name })} onClick=${() => remove(v)} />
            </div>`} />`}
    ${editing && html`<${VenueDialog} kind=${kind} venue=${editing} onClose=${() => setEditing(null)} onDone=${() => (setEditing(null), load())} />`}
  </div>`;
}

/** @param {{kind: 'spaces'|'rooms', venue: any, onClose: () => void, onDone: () => void}} p */
function VenueDialog({ kind, venue, onClose, onDone }) {
  const isNew = !venue.id;
  const [f, setF] = useState(
    kind === 'spaces'
      ? { name: venue.name ?? '', capacity_people: venue.capacity_people ?? '', color: venue.color ?? 'owner-8', description: venue.description ?? '', enabled: venue.enabled ?? true }
      : { name: venue.name ?? '', room_type: venue.room_type ?? '', capacity_guests: venue.capacity_guests ?? 2, beds: venue.beds ?? '', color: venue.color ?? 'owner-1', notes: venue.notes ?? '', enabled: venue.enabled ?? true },
  );
  const [errors, setErrors] = useState(/** @type {Record<string,string>} */ ({}));
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(venue.version);
  /** @param {string} k @param {any} v */
  const set = (k, v) => setF({ ...f, [k]: v });

  /** @param {Event} e */
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const body =
      kind === 'spaces'
        ? { ...f, capacity_people: f.capacity_people === '' ? null : Number(f.capacity_people) }
        : { ...f, capacity_guests: Number(f.capacity_guests) };
    try {
      if (isNew) await api('POST', `/${kind}`, { body });
      else await api('PATCH', `/${kind}/${venue.id}`, { body, version });
      toast('success', t('common.saved'));
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        toast('warning', t('errors.version_conflict'));
        setVersion((await api('GET', `/${kind}/${venue.id}`)).version);
      } else if (err instanceof ApiError) {
        setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, t(`errors.${v}`)])));
        if (!Object.keys(err.fields).length) toast('danger', err.text);
      }
    } finally {
      setBusy(false);
    }
  }

  const title = isNew ? (kind === 'spaces' ? t('admin.addSpace') : t('admin.addRoom')) : t('common.editName', { name: venue.name });
  return html`<${Modal} open onClose=${onClose} title=${title}
    footer=${html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
      <${Button} variant="primary" type="submit" form="venue-form" busy=${busy}>${t('common.save')}</${Button}>`}>
    <form id="venue-form" class="stack" onSubmit=${submit} noValidate>
      <${Field} label=${t('admin.venueName')} error=${errors.name} required>${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f.name} onInput=${(/** @type {string} */ v) => set('name', v)} />`}</${Field}>
      ${kind === 'spaces'
        ? html`<${Field} label=${t('admin.capacityPeople')} error=${errors.capacity_people} hint=${t('admin.capacityHint')}>
            ${(/** @type {any} */ a) => html`<${Input} ...${a} type="number" min="0" inputMode="numeric" value=${f.capacity_people} onInput=${(/** @type {string} */ v) => set('capacity_people', v)} />`}</${Field}>
          <${Field} label=${t('admin.spaceDescription')} error=${errors.description}>
            ${(/** @type {any} */ a) => html`<${Textarea} ...${a} value=${f.description} onInput=${(/** @type {string} */ v) => set('description', v)} rows="3" />`}</${Field}>`
        : html`<div class="field-row">
            <${Field} label=${t('admin.roomType')} error=${errors.room_type}>
              ${(/** @type {any} */ a) => html`<${Input} ...${a} list="room-types" value=${f.room_type} onInput=${(/** @type {string} */ v) => set('room_type', v)} />
                <datalist id="room-types">${ROOM_TYPES.map((x) => html`<option value=${x} />`)}</datalist>`}</${Field}>
            <${Field} label=${t('admin.capacityGuests')} error=${errors.capacity_guests} required>
              ${(/** @type {any} */ a) => html`<${Input} ...${a} type="number" min="1" inputMode="numeric" value=${f.capacity_guests} onInput=${(/** @type {string} */ v) => set('capacity_guests', v)} />`}</${Field}>
          </div>
          <${Field} label=${t('admin.beds')} error=${errors.beds} hint=${t('admin.bedsHint')}>
            ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f.beds} onInput=${(/** @type {string} */ v) => set('beds', v)} />`}</${Field}>
          <${Field} label=${t('admin.roomNotes')} error=${errors.notes}>
            ${(/** @type {any} */ a) => html`<${Textarea} ...${a} value=${f.notes} onInput=${(/** @type {string} */ v) => set('notes', v)} rows="3" />`}</${Field}>`}
      <div class="field"><span class="field-label">${t('admin.color')}</span>
        <${ColorPicker} value=${f.color} onChange=${(/** @type {string} */ v) => set('color', v)} legend=${t('admin.color')} /></div>
      <${Switch} checked=${f.enabled} onChange=${(/** @type {boolean} */ v) => set('enabled', v)} label=${t('admin.enabledHint')} />
    </form>
  </${Modal}>`;
}
