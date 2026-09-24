import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { user, isAdmin } from '../../state/session.js';
import { directory, loadVenues } from '../../state/venues.js';
import { invalidateEntries } from '../../state/entries.js';
import { api, ApiError } from '../../api.js';
import { Alert, Avatar, Badge, Button, Icon, SafeImg, Select, Skeleton } from '../../components/ui.js';
import { Modal } from '../../components/overlay.js';
import { toast } from '../../components/toast.js';
import { RichText } from '../../components/richtext.js';
import { fmtDateLong, fmtDayMonth, fmtMoney, fmtInstant } from '../../time.js';

export const TYPE_ICON = { event: 'ticket', blocked: 'lock', room_only: 'bed' };
export const TYPE_TONE = { event: 'event', blocked: 'blocked', room_only: 'room' };

/** @param {any} e */
export function priceText(e) {
  if (e.type !== 'event') return null;
  const base = e.price_cents == null ? t('entry.free') : fmtMoney(e.price_cents, e.currency);
  return e.price_note ? `${base} · ${e.price_note}` : base;
}

import { deleteEntryFlow } from './actions.js';
export { entryTitle } from './detail-title.js';

/**
 * The entry detail body (used by the panel, the phone sheet and /entries/:id).
 * @param {{id: string, onClose?: () => void, onChanged?: () => void, onLoaded?: (e: any) => void}} p
 */
export function EntryDetail({ id, onClose, onChanged, onLoaded }) {
  const [e, setE] = useState(/** @type {any} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [reassign, setReassign] = useState(false);

  const load = async () => {
    try {
      const x = await api('GET', `/entries/${id}`);
      setE(x);
      onLoaded?.(x);
    } catch (err) {
      setError(err instanceof ApiError ? err.text : t('errors.generic'));
    }
  };
  useEffect(() => {
    setE(null);
    setError(null);
    load();
  }, [id]);

  if (error) return html`<${Alert} tone="danger">${error}</${Alert}>`;
  if (!e) return html`<div class="stack"><${Skeleton} h="180px" /><${Skeleton} h="24px" w="70%" /><${Skeleton} h="80px" /></div>`;

  async function remove() {
    if (await deleteEntryFlow(e)) {
      onChanged?.();
      onClose?.();
    }
  }

  const cover = e.type === 'event' && (e.cover_media_id ? `/media/${e.cover_media_id}/original` : e.cover_url);
  const me = user.value;
  const canRooms = me && (me.role === 'admin' || me.role === 'moderator' || e.owner.id === me.id);

  return html`<article class="entry-detail stack">
    ${cover && html`<div class="entry-cover"><${SafeImg} src=${cover} /></div>`}
    <div class="stack" style=${{ '--stack-gap': 'var(--space-2)' }}>
      <div class="cluster">
        <${Badge} tone=${TYPE_TONE[e.type]} icon=${TYPE_ICON[e.type]}>${t(`entryType.${e.type}`)}</${Badge}>
        ${e.series_id && html`<${Badge} icon="repeat">${t('entry.seriesOf', { freq: e.series_freq ?? '', i: (e.occurrence_index ?? 0) + 1, n: e.series_total })}</${Badge}>`}
        ${e.past && html`<${Badge}>${t('entry.past')}</${Badge}>`}
        ${e.allow_overlap && isAdmin.value && html`<${Badge} tone="warning" icon="layers">${t('entry.overlapAllowed')}</${Badge}>`}
      </div>
      <div class="owner-inline">
        <${Avatar} name=${e.owner.name} color=${e.owner.color} initials=${e.owner.initials} size="sm" />
        <span>${e.owner.name}${e.owner.former ? ` (${t('entry.formerUser')})` : ''}</span>
      </div>
    </div>

    ${e.sessions.length > 0 && html`<section class="detail-block">
      <${Icon} name="clock" />
      <ul class="plain-list" role="list">${e.sessions.map((s) => html`<li class="num">${fmtDateLong(s.date)} · ${s.start}–${s.end}</li>`)}</ul>
    </section>`}
    ${e.space && html`<section class="detail-block"><${Icon} name="map-pin" />
      <div>${e.space.name}${e.space.capacity_people != null && html`<span class="muted"> · ${t('common.seats', { n: e.space.capacity_people })}</span>`}</div></section>`}
    ${e.type === 'blocked' && !e.space && html`<section class="detail-block"><${Icon} name="map-pin" /><div>${t('schedule.wholeVenue')}</div></section>`}
    ${e.room_bookings.length > 0 && canRooms !== undefined && html`<section class="detail-block"><${Icon} name="bed" />
      <ul class="plain-list" role="list">${e.room_bookings.map(
        (b) => html`<li>${b.room_name} · ${fmtDayMonth(b.check_in)}–${fmtDayMonth(b.check_out)}${b.guests != null ? ` · ${t('common.guests', { n: b.guests })}` : ''}
          ${b.guest_names && html`<div class="small muted">${b.guest_names}</div>`}</li>`,
      )}</ul></section>`}
    ${e.type === 'event' && html`<section class="detail-block"><${Icon} name="tag" /><div>${priceText(e)}</div></section>`}
    ${e.enroll_url && html`<div><a class="btn btn--primary" href=${e.enroll_url} target="_blank" rel="noopener noreferrer"><${Icon} name="external-link" />${t('entry.enroll')}</a></div>`}
    ${e.type === 'blocked' && e.description === null
      ? html`<p class="muted small"><${Icon} name="lock" /> ${t('entry.privateNotes')}</p>`
      : e.description && html`<div class="entry-description"><${RichText} text=${e.description} /></div>`}
    ${isAdmin.value && e.type === 'event' && html`<${PromotionBlock} e=${e} />`}

    ${e.series_id && html`<${SeriesList} seriesId=${e.series_id} current=${e.id} />`}
    ${!e.can_edit && html`<p class="small muted view-only"><${Icon} name="eye" /> ${t('entry.viewOnly', { name: e.owner.name })}</p>`}
    <p class="xs muted">${t('entry.updated', { when: fmtInstant(e.updated_at) })}</p>

    <div class="entry-actions cluster">
      ${e.can_edit && html`<${Button} variant="primary" icon="pencil" href=${`/entries/${e.id}/edit`}>${t('common.edit')}</${Button}>`}
      ${e.type !== 'room_only' || canRooms ? html`<${Button} icon="copy" href=${`/schedule?duplicate=${e.id}`}>${t('entry.duplicate')}</${Button}>` : null}
      ${isAdmin.value && html`<${Button} icon="user-round-cog" onClick=${() => setReassign(true)}>${t('entry.reassign')}</${Button}>`}
      ${e.can_delete && html`<${Button} variant="danger-ghost" icon="trash-2" onClick=${remove}>${t('common.delete')}</${Button}>`}
    </div>
    ${reassign && html`<${ReassignDialog} entry=${e} onClose=${() => setReassign(false)} onDone=${() => (setReassign(false), load(), invalidateEntries(), onChanged?.())} />`}
  </article>`;
}

/** @param {{entry: any, onClose: () => void, onDone: () => void}} p */
function ReassignDialog({ entry, onClose, onDone }) {
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadVenues();
  }, []);
  async function submit() {
    setBusy(true);
    try {
      await api('POST', `/entries/${entry.id}/reassign`, { body: { ownerId: owner } });
      toast('success', t('entry.reassigned'));
      onDone();
    } catch (err) {
      toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }
  const users = (directory.value ?? []).filter((u) => u.id !== entry.owner.id);
  return html`<${Modal} open onClose=${onClose} title=${t('entry.reassignTitle')}
    footer=${html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
      <${Button} variant="primary" busy=${busy} disabled=${!owner} onClick=${submit}>${t('entry.reassign')}</${Button}>`}>
    <div class="field">
      <label for="reassign-owner">${t('entry.newOwner')}</label>
      <${Select} id="reassign-owner" value=${owner} onChange=${setOwner} placeholder=${t('admin.chooseUser')}
        options=${users.map((u) => ({ value: u.id, label: u.name }))} />
    </div>
  </${Modal}>`;
}

/** "See all occurrences": the dates of the series, each linking to its entry. @param {{seriesId: string, current: string}} p */
function SeriesList({ seriesId, current }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(/** @type {any} */ (null));
  useEffect(() => {
    if (open && !data) api('GET', `/series/${seriesId}`).then(setData).catch(() => {});
  }, [open]);
  return html`<section class="detail-block"><${Icon} name="repeat" />
    <div class="stack" style=${{ '--stack-gap': 'var(--space-2)' }}>
      <button type="button" class="link-btn small" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}>${t('series.seeAll')}</button>
      ${open && (data
        ? html`<ul class="occurrence-list" role="list">${data.occurrences.map(
            (/** @type {any} */ o) => html`<li><a class=${`chip ${o.id === current ? 'chip--selected' : ''}`} href=${`?entry=${o.id}`}
              aria-current=${o.id === current ? 'true' : undefined} data-past=${o.past ? 'true' : undefined}>${fmtDayMonth(o.date)}</a></li>`,
          )}</ul>`
        : html`<${Skeleton} h="28px" />`)}
    </div>
  </section>`;
}

/** Admins: the event's promotion status, its posts and a shortcut to promote it. @param {{e: any}} p */
function PromotionBlock({ e }) {
  const [posts, setPosts] = useState(/** @type {any[]} */ ([]));
  useEffect(() => {
    let live = true;
    api('GET', '/posts', { query: { event: e.id } })
      .then((r) => live && setPosts(r.items))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [e.id, e.version]);
  return html`<section class="detail-block"><${Icon} name="megaphone" />
    <div class="stack" style=${{ '--stack-gap': 'var(--space-2)' }}>
      <div class="cluster" style=${{ '--cluster-gap': 'var(--space-2)' }}>
        <${Badge} tone=${e.promotion_status === 'promoted' ? 'success' : e.promotion_status === 'skipped' ? 'neutral' : 'warning'}>
          ${t(`entry.promo_${e.promotion_status ?? 'pending'}`)}</${Badge}>
        <a class="small" href=${`/social/queue?edit=new&event=${e.id}`}>${t('social.createPost')}</a>
      </div>
      ${posts.length > 0 && html`<ul class="plain-list small">
        ${posts.map((p) => html`<li><a href=${`/social?post=${p.id}&date=${p.publish_date}`}>${p.platform.name} · ${fmtDayMonth(p.publish_date)} · ${p.title}</a></li>`)}
      </ul>`}
    </div>
  </section>`;
}
