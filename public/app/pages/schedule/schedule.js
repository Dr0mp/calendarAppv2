import { useLocation, useRoute } from 'preact-iso';
import { html, useEffect, useMemo, useRef, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { user, isStaff, isAdmin, isDemo } from '../../state/session.js';
import { store } from '../../state/prefs.js';
import { usePageChrome } from '../../state/chrome.js';
import { loadVenues, spaces, spaceById, rooms as roomList } from '../../state/venues.js';
import { invalidateEntries } from '../../state/entries.js';
import { refreshCounts } from '../../state/counts.js';
import { api, ApiError } from '../../api.js';
import { Alert, Button, Field, Icon, Input, Segmented, SkeletonList, Switch, Textarea, Select } from '../../components/ui.js';
import { confirm } from '../../components/overlay.js';
import { toast } from '../../components/toast.js';
import { isCompact } from '../../components/media-query.js';
import { defaultStart, fmtDateShort, today } from '../../time.js';
import { EntryInput } from '/shared/schemas/entry.js';
import { internalOverlaps, findRoomConflicts } from '/shared/rules/conflicts.js';
import { isEntryPast } from '/shared/rules/permissions.js';
import { orgTz } from '../../state/session.js';
import { emptyForm, fromEntry, parsePrice, shiftSessions, toPayload } from './model.js';
import { DateTimeSection } from './sessions.js';
import { RoomRows } from './rooms.js';
import { CoverPicker } from './cover.js';
import { RecurrenceSection, recurrenceSummary, toRecurrence } from './recurrence.js';

const SECTIONS = ['type', 'details', 'datetime', 'recurrence', 'rooms', 'publishing'];
/** @type {Record<string, string>} */
const SECTION_KEYS = {
  type: 'schedule.secType',
  details: 'schedule.secDetails',
  datetime: 'schedule.secDateTime',
  recurrence: 'schedule.secRecurrence',
  rooms: 'schedule.secRooms',
  publishing: 'schedule.secPublishing',
};

/**
 * The scheduling form page (/schedule, /entries/:id/edit). With `embedded`,
 * it renders inside the calendar's quick-create side panel instead.
 * @param {{embedded?: {date: string, time?: string, space?: string, onClose: () => void, onSaved: (e: any) => void}}} [props]
 */
export default function Schedule(props = {}) {
  const { params } = useRoute();
  const loc = useLocation();
  const { route } = loc;
  const embedded = props.embedded ?? null;
  const query = embedded ? { date: embedded.date, time: embedded.time, space: embedded.space } : loc.query;
  const editId = embedded ? null : params.id ?? null;
  const [loaded, setLoaded] = useState(false);
  const [entry, setEntry] = useState(/** @type {any} */ (null));
  const [initial, setInitial] = useState(/** @type {import('./model.js').FormState|null} */ (null));
  const [form, setForm] = useState(/** @type {import('./model.js').FormState|null} */ (null));
  const [draftRestored, setDraftRestored] = useState(false);
  const [loadError, setLoadError] = useState(/** @type {string|null} */ (null));
  const u = /** @type {any} */ (user.value);
  const draftKey = `draft.${u.id}.${editId ?? 'new'}`;

  usePageChrome(editId ? t('schedule.editTitle') : t('schedule.title'), undefined, !!embedded);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await loadVenues();
        let base;
        let version = null;
        if (editId) {
          const e = await api('GET', `/entries/${editId}`);
          if (!live) return;
          if (!e.can_edit) {
            setLoadError(t('schedule.cannotEdit'));
            return;
          }
          setEntry(e);
          version = e.version;
          base = fromEntry(e);
        } else if (query.duplicate) {
          const e = await api('GET', `/entries/${query.duplicate}`);
          base = fromEntry(e);
          base.title = e.title ?? '';
          base = await duplicateDates(base);
        } else {
          const start = query.date ? { date: query.date, time: query.time ?? defaultStart().time } : defaultStart();
          const type = ['event', 'blocked', 'room_only'].includes(query.type) && (query.type !== 'room_only' || isStaff.value) ? query.type : 'event';
          base = emptyForm(start, { type: /** @type {any} */ (type), space_id: query.space ?? '' });
          if (type === 'room_only') base.room_bookings = [newBooking(query.date ?? today())];
        }
        if (!live) return;
        setInitial(base);
        // A draft is restored only against the same version of the entry it was written for.
        const draft = store.get(draftKey);
        if (draft?.form && JSON.stringify(draft.form) !== JSON.stringify(base) && (draft.version ?? null) === version && !query.duplicate) {
          setForm({ ...base, ...draft.form });
          setDraftRestored(true);
        } else setForm(base);
        setLoaded(true);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.text : t('errors.generic'));
      }
    })();
    return () => {
      live = false;
    };
  }, [editId, query.duplicate]);

  if (loadError) {
    return html`<div class="stack"><${Alert} tone="danger">${loadError}</${Alert}><div><${Button} href="/calendar">${t('shell.backToCalendar')}</${Button}></div></div>`;
  }
  if (!loaded || !form || !initial) return html`<${SkeletonList} rows=${6} />`;
  return html`<${EntryForm} key=${editId ?? 'new'} entry=${entry} initial=${initial} form=${form} setForm=${setForm} draftKey=${draftKey}
    embedded=${embedded}
    draftRestored=${draftRestored} onDiscardDraft=${() => {
      store.set(draftKey, null);
      setForm(initial);
      setDraftRestored(false);
    }}
    onSaved=${(/** @type {any} */ saved) => {
      store.set(draftKey, null);
      invalidateEntries();
      refreshCounts();
      if (embedded) embedded.onSaved(saved);
      else route(`/calendar?view=day&date=${saved.first_date}&entry=${saved.id}`);
    }} />`;
}

/** A new room row: the first enabled room, one night. @param {string} date */
function newBooking(date) {
  const room = (roomList.value ?? []).find((r) => r.enabled);
  return { room_id: room?.id ?? '', check_in: date, check_out: shiftDate(date, 1), guests: 1, guest_names: '' };
}

/** @param {string} d @param {number} n */
function shiftDate(d, n) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/**
 * Duplicates land on the next free slot: keep the times, move to the
 * default start day (or the next day when that time has passed), then
 * take the first suggestion if that is busy.
 * @param {import('./model.js').FormState} base
 */
async function duplicateDates(base) {
  if (base.type === 'room_only' || !base.sessions.length) {
    const d = today();
    const first = base.room_bookings[0]?.check_in ?? d;
    const diff = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
    return { ...base, room_bookings: base.room_bookings.map((b) => ({ ...b, check_in: shiftDate(b.check_in, diff + 1), check_out: shiftDate(b.check_out, diff + 1) })) };
  }
  const start = defaultStart();
  const first = base.sessions[0];
  let date = start.date;
  if (first.start < start.time && date === today()) date = shiftDate(date, 1);
  let sessions = shiftSessions(base.sessions, date);
  try {
    const a = await api('POST', '/availability', { body: { type: base.type, spaceId: base.space_id || null, sessions } });
    const opt = a.suggestions?.[0]?.options?.find((/** @type {any} */ o) => o.kind !== 'same_day') ?? a.suggestions?.[0]?.options?.[0];
    if (opt) sessions = shiftSessions(sessions, opt.session.date);
  } catch {
    /* keep the shifted dates */
  }
  return { ...base, sessions };
}

/**
 * @param {{entry: any, initial: import('./model.js').FormState, form: import('./model.js').FormState,
 *   setForm: (f: any) => void, draftKey: string, draftRestored: boolean, onDiscardDraft: () => void, onSaved: (e: any) => void,
 *   embedded: any}} p
 */
function EntryForm({ entry, initial, form, setForm, draftKey, draftRestored, onDiscardDraft, onSaved, embedded }) {
  const { route } = useLocation();
  const staff = isStaff.value;
  const admin = isAdmin.value;
  const [errors, setErrors] = useState(/** @type {Record<string,string>} */ ({}));
  const [avail, setAvail] = useState(/** @type {any} */ (null));
  const [fullDay, setFullDayState] = useState(!!store.get('schedule.fullDay'));
  const [busy, setBusy] = useState(false);
  const [coverCheck, setCoverCheck] = useState(/** @type {import('./cover.js').CoverCheck} */ ({ status: 'empty' }));
  const [serverConflict, setServerConflict] = useState(/** @type {any} */ (null));
  const [version, setVersion] = useState(entry?.version ?? null);
  const [open, setOpen] = useState(() => new Set(SECTIONS));
  const saving = useRef(false);

  /** @param {Partial<import('./model.js').FormState>} patch */
  const set = (patch) => {
    setForm((/** @type {any} */ f) => ({ ...f, ...patch }));
    if (patch.sessions || patch.space_id !== undefined || patch.type) setServerConflict(null);
  };
  const setFullDay = (/** @type {boolean} */ v) => {
    setFullDayState(v);
    store.set('schedule.fullDay', v);
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  // Autosave the draft (per user) while editing.
  useEffect(() => {
    if (!dirty) return;
    const id = setTimeout(() => store.set(draftKey, { form, version: entry?.version ?? null, savedAt: Date.now() }), 400);
    return () => clearTimeout(id);
  }, [form]);

  // Leaving with unsaved changes asks first: browser navigation...
  useEffect(() => {
    if (!dirty) return;
    /** @param {BeforeUnloadEvent} e */
    const onUnload = (e) => {
      if (saving.current) return;
      e.preventDefault();
    };
    // ...and in-app links.
    /** @param {MouseEvent} e */
    const onClick = async (e) => {
      const a = /** @type {HTMLElement} */ (e.target).closest?.('a[href]');
      if (!a || saving.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('/') || a.getAttribute('target')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const ok = await confirm({ title: t('schedule.leaveTitle'), message: t('schedule.leaveText'), confirmLabel: t('schedule.leave'), danger: true });
      if (ok) {
        saving.current = true;
        route(href);
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  // Live availability (debounced): conflicts, suggestions, busy strip.
  const availKey = JSON.stringify([form.type, form.space_id, form.sessions, staff && (form.type === 'room_only' || form.needsRooms) ? form.room_bookings : []]);
  useEffect(() => {
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      const sessions = form.type === 'room_only' ? [] : form.sessions.filter((s) => s.end > s.start || s.end === '24:00');
      const rooms = staff && (form.type === 'room_only' || form.needsRooms) ? form.room_bookings.filter((b) => b.room_id && b.check_out > b.check_in) : [];
      if (!sessions.length && !rooms.length) return setAvail(null);
      try {
        const r = await api('POST', '/availability', {
          body: {
            type: form.type,
            spaceId: form.type === 'room_only' ? null : form.space_id || (form.type === 'blocked' ? null : undefined),
            sessions: form.type === 'event' && !form.space_id ? [] : sessions,
            rooms: rooms.map((b) => ({ room_id: b.room_id, check_in: b.check_in, check_out: b.check_out })),
            excludeEntryId: entry?.id ?? null,
            dates: sessions.map((s) => s.date),
          },
          signal: ctrl.signal,
        });
        if (form.type === 'event' && !form.space_id) {
          // Without a space nothing is busy yet; keep the strip neutral.
          r.busy = Object.fromEntries(sessions.map((s) => [s.date, []]));
        }
        setAvail(r);
      } catch {
        /* network hiccup: keep the last result */
      }
    }, 300);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [availKey]);

  const spaceOptions = (spaces.value ?? [])
    .filter((s) => s.enabled || s.id === initial.space_id)
    .map((s) => ({ value: s.id, label: s.capacity_people != null ? `${s.name} · ${t('common.seats', { n: s.capacity_people })}` : s.name }));

  const isEvent = form.type === 'event';
  const showRooms = staff && (form.type === 'room_only' || (isEvent && form.needsRooms));
  const coverBlocks = isEvent && (coverCheck.status === 'bad' || coverCheck.status === 'error') && !!(form.cover_url || form.cover_media_id);
  const pastWarning = entry && isEntryPast(entry, orgTz.value);

  /** @param {'event'|'blocked'|'room_only'} type */
  function setType(type) {
    // Changing the type keeps every field that still applies.
    /** @type {Partial<import('./model.js').FormState>} */
    const patch = { type };
    if (type === 'room_only' && !form.room_bookings.length) patch.room_bookings = [newBooking(form.sessions[0]?.date ?? today())];
    if (type !== 'room_only' && !form.sessions.length) patch.sessions = emptyForm(defaultStart()).sessions;
    set(patch);
    setErrors({});
  }

  /** Client validation with the shared schema, plus form-only checks. */
  function validate() {
    const payload = toPayload(form, { staff });
    /** @type {Record<string,string>} */ const errs = {};
    const r = EntryInput.safeParse(payload);
    if (!r.success) {
      for (const i of r.error.issues) {
        const k = i.path.join('.') || '_';
        errs[k] ??= /^[a-z_]+$/.test(i.message) ? i.message : i.code;
      }
    }
    if (isEvent && !form.free) {
      const cents = parsePrice(form.price);
      if (cents === null || Number.isNaN(cents)) errs.price = 'price_required';
    }
    if (coverBlocks) errs.cover = coverCheck.status === 'bad' ? 'cover_not_16_9' : 'cover_load_error';
    if (form.type !== 'room_only' && internalOverlaps(form.sessions).length) errs['sessions.0.start'] ??= 'sessions_overlap';
    if (showRooms && findRoomConflicts(/** @type {any} */ (form.room_bookings), []).length) errs.room_bookings = 'room_rows_overlap';
    if (showRooms) form.room_bookings.forEach((b, i) => !b.room_id && (errs[`room_bookings.${i}.room_id`] = 'required'));
    return { payload, errs };
  }

  /** Scroll to and focus the first invalid field. @param {Record<string,string>} errs */
  function focusFirst(errs) {
    const order = ['title', 'space_id', 'sessions', 'room_bookings', 'price', 'currency', 'enroll_url', 'cover'];
    const keys = Object.keys(errs).sort((a, b) => order.findIndex((o) => a.startsWith(o)) - order.findIndex((o) => b.startsWith(o)));
    for (const k of keys) {
      const id = `f-${k.replace(/\./g, '-')}`;
      const el = document.getElementById(id) ?? document.getElementById(`f-${k.split('.')[0]}`) ?? document.getElementById(`f-${k.split('.').slice(0, 3).join('-')}`);
      if (el) {
        const sec = el.closest('[data-section]');
        if (sec) setOpen((o) => new Set([...o, /** @type {string} */ (sec.getAttribute('data-section'))]));
        requestAnimationFrame(() => {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          /** @type {HTMLElement} */ (el).focus({ preventScroll: true });
        });
        return;
      }
    }
  }

  async function save() {
    const { payload, errs } = validate();
    setErrors(errs);
    if (Object.keys(errs).length) {
      focusFirst(errs);
      toast('danger', t('errors.validation_error'));
      return;
    }
    if (avail?.conflicts?.length && !form.allow_overlap) {
      setServerConflict(avail.conflicts);
      document.getElementById('conflicts')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      toast('danger', t('errors.space_conflict'));
      return;
    }
    // Editing an occurrence of a series asks for the scope, with a real Cancel.
    let scope = 'one';
    if (entry?.series_id) {
      const choice = await confirm({
        title: t('series.editScopeTitle'),
        confirmLabel: t('common.save'),
        choices: [
          { value: 'one', label: t('series.scopeOne') },
          { value: 'following', label: t('series.scopeFollowing'), hint: t('series.scopeFollowingHint') },
          { value: 'all', label: t('series.scopeAll'), hint: t('series.scopeAllHint') },
        ],
      });
      if (!choice) return;
      scope = choice;
    }
    setBusy(true);
    saving.current = true;
    try {
      const saved = entry
        ? await api('PATCH', `/entries/${entry.id}`, { body: payload, version, query: { scope } })
        : await api('POST', '/entries', { body: { entry: payload, recurrence: toRecurrence(form.recurrence) } });
      toast('success', entry ? t('schedule.updated') : form.recurrence && saved.created > 1 ? t('schedule.createdSeries', { n: saved.created }) : t(`schedule.created_${form.type}`));
      onSaved(saved);
    } catch (err) {
      saving.current = false;
      if (!(err instanceof ApiError)) throw err;
      if (err.code === 'version_conflict') {
        // Reload the item, keep what the user typed.
        toast('warning', t('errors.version_conflict'));
        const fresh = await api('GET', `/entries/${entry.id}`);
        setVersion(fresh.version);
      } else if (err.code === 'space_conflict' || err.code === 'room_conflict') {
        setServerConflict(err.details);
        toast('danger', err.details?.dates?.length > 1 || (form.recurrence && err.details?.dates?.length)
          ? t('series.conflictDates', { dates: err.details.dates.map((/** @type {string} */ d) => fmtDateShort(d)).join(', ') })
          : err.text);
        document.getElementById('conflicts')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (Object.keys(err.fields).length) {
        setErrors(err.fields);
        focusFirst(err.fields);
        toast('danger', err.text);
      } else {
        toast('danger', err.text);
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (dirty) {
      const ok = await confirm({ title: t('schedule.leaveTitle'), message: t('schedule.leaveText'), confirmLabel: t('schedule.leave'), danger: true });
      if (!ok) return;
    }
    saving.current = true;
    if (embedded) embedded.onClose();
    else history.length > 1 ? history.back() : route('/calendar');
  }

  /** @param {boolean} on */
  async function onOverride(on) {
    if (on) {
      const ok = await confirm({ title: t('schedule.allowOverlapTitle'), message: t('schedule.allowOverlapConfirm'), confirmLabel: t('schedule.allowOverlap') });
      if (!ok) return;
    }
    set({ allow_overlap: on });
  }

  const err = (/** @type {string} */ k) => (errors[k] ? t(`errors.${errors[k]}`) : null);
  const summary = useMemo(() => buildSummary(form), [form]);
  const saveLabel = { event: t('schedule.saveEvent'), blocked: t('schedule.confirmBlock'), room_only: t('schedule.saveBooking') }[form.type];
  const conflictCount = (avail?.conflicts?.length ?? 0) + (avail?.roomConflicts?.length ?? 0);

  /** @param {string} id @param {string} title @param {any} body @param {string} [hint] */
  const section = (id, title, body, hint) => {
    const isOpen = !isCompact.value || open.has(id);
    const secErrors = Object.keys(errors).filter((k) => sectionOf(k) === id).length;
    return html`<section class="form-section card" id=${`sec-${id}`} data-section=${id} aria-labelledby=${`sec-${id}-h`}>
      <button type="button" class="form-section-head" aria-expanded=${isOpen ? 'true' : 'false'} aria-controls=${`sec-${id}-body`}
        onClick=${() => isCompact.value && setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; })}>
        <h2 id=${`sec-${id}-h`}>${title}</h2>
        ${secErrors > 0 && html`<span class="count count--danger" aria-label=${t('schedule.sectionErrors', { n: secErrors })}>${secErrors}</span>`}
        <span class="only-compact ms-auto"><${Icon} name=${isOpen ? 'chevron-up' : 'chevron-down'} /></span>
      </button>
      <div class="form-section-body" id=${`sec-${id}-body`} hidden=${!isOpen}>
        ${hint && html`<p class="small muted">${hint}</p>`}
        ${body}
      </div>
    </section>`;
  };

  const visible = SECTIONS.filter((s) =>
    s === 'datetime' ? form.type !== 'room_only' :
    s === 'recurrence' ? form.type !== 'room_only' && form.mode !== 'multiday' && !entry :
    s === 'rooms' ? staff && form.type !== 'blocked' :
    s === 'publishing' ? isEvent : true,
  );

  return html`<div class=${`schedule ${embedded ? 'schedule--embedded' : ''}`}>
    ${!embedded && html`<div class="page-head">
      <h1>${entry ? t('schedule.editTitle') : t('schedule.title')}</h1>
    </div>`}
    <div class="schedule-grid">
      <form class="schedule-form stack" onSubmit=${(/** @type {Event} */ e) => (e.preventDefault(), save())} noValidate>
        ${draftRestored && html`<${Alert} tone="info"><span>${t('schedule.draftRestored')} <button type="button" class="link-btn" onClick=${onDiscardDraft}>${t('schedule.discardDraft')}</button></span></${Alert}>`}
        ${pastWarning && html`<${Alert} tone="warning">${t('schedule.pastWarning')}</${Alert}>`}
        ${entry?.series_id && html`<${Alert} tone="info">${t('schedule.editingOccurrence')}</${Alert}>`}

        ${section('type', t('schedule.secType'), html`<${Segmented} label=${t('schedule.secType')} value=${form.type} onChange=${setType} block wrap
          options=${[
            { value: 'event', label: t('entryType.event'), icon: 'ticket' },
            { value: 'blocked', label: t('entryType.blocked'), icon: 'lock' },
            ...(staff ? [{ value: 'room_only', label: t('entryType.room_only'), icon: 'bed' }] : []),
          ]} />`)}

        ${section('details', t('schedule.secDetails'), html`<div class="stack">
          <${Field} id="f-title" label=${{ event: t('schedule.titleEvent'), blocked: t('schedule.titleBlocked'), room_only: t('schedule.titleRoom') }[form.type]}
            error=${err('title')} required counter=${{ n: form.title.length, max: 120 }}>
            ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${form.title} maxLength="140" onInput=${(/** @type {string} */ v) => set({ title: v })} />`}
          </${Field}>
          ${form.type !== 'room_only' && html`<${Field} id="f-space_id" label=${t('schedule.space')} error=${err('space_id')} required=${isEvent}
            hint=${form.type === 'blocked' ? t('schedule.spaceOptionalHint') : null}>
            ${(/** @type {any} */ a) => html`<${Select} ...${a} value=${form.space_id} onChange=${(/** @type {string} */ v) => set({ space_id: v })}
              placeholder=${isEvent ? t('schedule.chooseSpace') : t('schedule.wholeVenue')} options=${spaceOptions} />`}
          </${Field}>`}
          <${Field} id="f-description" label=${form.type === 'blocked' ? t('schedule.privateNotes') : t('schedule.description')} error=${err('description')}
            hint=${form.type === 'blocked' ? t('schedule.privateNotesHint') : t('schedule.descriptionHint')}>
            ${(/** @type {any} */ a) => html`<${Textarea} ...${a} rows="4" value=${form.description} onInput=${(/** @type {string} */ v) => set({ description: v })} />`}
          </${Field}>
        </div>`)}

        ${visible.includes('datetime') && section('datetime', t('schedule.secDateTime'), html`<${DateTimeSection} form=${form} set=${set} avail=${avail} errors=${errors}
          fullDay=${fullDay} setFullDay=${setFullDay} canOverride=${admin} serverConflict=${serverConflict} onOverride=${onOverride} />
          ${errors.sessions && html`<${Alert} tone="danger">${t(`errors.${errors.sessions}`)}</${Alert}>`}`)}

        ${visible.includes('recurrence') && section('recurrence', t('schedule.secRecurrence'), html`<${RecurrenceSection} form=${form} set=${set} />`)}

        ${visible.includes('rooms') && section('rooms', t('schedule.secRooms'), html`<div class="stack">
          ${isEvent && html`<${Switch} checked=${form.needsRooms} onChange=${(/** @type {boolean} */ v) =>
            set({ needsRooms: v, room_bookings: v && !form.room_bookings.length ? [newBooking(form.sessions[0]?.date ?? today())] : form.room_bookings })}
            label=${t('schedule.needsRooms')} />`}
          ${showRooms && html`<${RoomRows} form=${form} set=${set} errors=${errors} avail=${avail} defaultDate=${form.sessions[0]?.date ?? today()} />`}
        </div>`)}

        ${visible.includes('publishing') && section('publishing', t('schedule.secPublishing'), html`<div class="stack">
          <div class="field">
            <span class="field-label">${t('schedule.price')}<span class="req" aria-hidden="true">*</span></span>
            <${Switch} checked=${form.free} onChange=${(/** @type {boolean} */ v) => set({ free: v })} label=${t('schedule.free')} />
            ${!form.free && html`<div class="price-row">
              <input id="f-price" class="input num" inputMode="decimal" placeholder="75" value=${form.price} aria-label=${t('schedule.amount')}
                aria-invalid=${errors.price ? 'true' : undefined} onInput=${(/** @type {any} */ e) => set({ price: e.currentTarget.value })} />
              <select id="f-currency" class="select" value=${form.currency} aria-label=${t('schedule.currency')}
                onChange=${(/** @type {any} */ e) => set({ currency: e.currentTarget.value })}>
                <option value="RON" selected=${form.currency === 'RON'}>RON</option><option value="EUR" selected=${form.currency === 'EUR'}>EUR</option>
              </select>
            </div>`}
            ${(errors.price || errors.price_cents) && html`<div class="field-error"><${Icon} name="circle-alert" />${t(`errors.${errors.price ?? errors.price_cents}`)}</div>`}
          </div>
          <${Field} id="f-price_note" label=${t('schedule.priceNote')} hint=${t('schedule.priceNoteHint')}>
            ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${form.price_note} onInput=${(/** @type {string} */ v) => set({ price_note: v })} />`}
          </${Field}>
          <${Field} id="f-enroll_url" label=${t('schedule.enrollUrl')} error=${err('enroll_url')} required hint=${t('schedule.enrollUrlHint')}>
            ${(/** @type {any} */ a) => html`<${Input} ...${a} type="url" inputMode="url" placeholder="https://…" value=${form.enroll_url}
              onInput=${(/** @type {string} */ v) => set({ enroll_url: v })} />`}
          </${Field}>
          <div class="field">
            <span class="field-label">${t('schedule.cover')}<span class="req" aria-hidden="true">*</span></span>
            <p class="field-hint">${t('schedule.coverHint')}</p>
            <${CoverPicker} url=${form.cover_url} mediaId=${form.cover_media_id} check=${coverCheck} onCheck=${setCoverCheck}
              error=${errors.cover ? t(`errors.${errors.cover}`) : null} onChange=${(/** @type {any} */ p) => set(p)}
              extra=${isDemo.value && html`<div><${Button} size="sm" icon="image" onClick=${() => set({ cover_url: `${location.origin}/sample/cover-16x9.webp`, cover_media_id: null })}>
                ${t('schedule.useSample')}</${Button}></div>`} />
          </div>
        </div>`)}
        <div class="schedule-spacer" aria-hidden="true"></div>
      </form>

      <aside class="schedule-aside" aria-label=${t('schedule.summary')}>
        <nav class="section-index" aria-label=${t('schedule.sections')}>
          ${visible.map((s) => {
            const n = Object.keys(errors).filter((k) => sectionOf(k) === s).length;
            return html`<a href=${`#sec-${s}`} onClick=${(/** @type {Event} */ e) => {
              e.preventDefault();
              document.getElementById(`sec-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}>${t(SECTION_KEYS[s])}${n > 0 && html`<span class="count count--danger">${n}</span>`}</a>`;
          })}
        </nav>
        <div class="card aside-status">
          <div class="section-title">${t('schedule.summary')}</div>
          <p class="summary-text">${summary}</p>
          ${conflictCount > 0
            ? html`<p class="small text-danger"><${Icon} name="circle-alert" /> ${t('schedule.conflictsTitle', { n: conflictCount })}</p>`
            : avail && html`<p class="small text-success"><${Icon} name="circle-check" /> ${t('schedule.noConflicts')}</p>`}
        </div>
      </aside>
    </div>

    <div class="action-bar" role="region" aria-label=${t('schedule.actions')}>
      <div class="action-bar-inner">
        <p class="action-summary" aria-live="polite">${summary}</p>
        <${Button} onClick=${cancel}>${t('common.cancel')}</${Button}>
        <${Button} variant="primary" busy=${busy} onClick=${save} disabled=${coverBlocks}>${saveLabel}</${Button}>
      </div>
    </div>
  </div>`;
}

/** Which section a field error belongs to. @param {string} k */
function sectionOf(k) {
  if (k.startsWith('title') || k.startsWith('space_id') || k.startsWith('description')) return 'details';
  if (k.startsWith('sessions')) return 'datetime';
  if (k.startsWith('room_bookings')) return 'rooms';
  if (['price', 'price_cents', 'currency', 'price_note', 'enroll_url', 'cover'].some((p) => k.startsWith(p))) return 'publishing';
  return 'type';
}

/**
 * "Eveniment public · Sala Mare · joi 1 oct, 18:00–20:00 · 3 sesiuni"
 * @param {import('./model.js').FormState} f
 */
function buildSummary(f) {
  const parts = [t(`entryType.${f.type}`)];
  if (f.type !== 'room_only') {
    const space = spaceById(f.space_id);
    parts.push(space ? space.name.replace(/\s*\(.*\)$/, '') : f.type === 'blocked' ? t('schedule.wholeVenue') : t('schedule.noSpace'));
    const s = f.sessions[0];
    if (s) parts.push(`${fmtDateShort(s.date)}, ${s.start}–${s.end}`);
    if (f.sessions.length > 1) parts.push(t('schedule.nSessions', { n: f.sessions.length }));
    const rec = recurrenceSummary(f);
    if (rec) parts.push(rec);
  } else {
    parts.push(t('schedule.nRooms', { n: f.room_bookings.length }));
    const b = f.room_bookings[0];
    if (b) parts.push(`${fmtDateShort(b.check_in)} → ${fmtDateShort(b.check_out)}`);
  }
  return parts.join(' · ');
}
