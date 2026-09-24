import { html, useEffect, useMemo, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { api, ApiError, errorText } from '../../api.js';
import { store } from '../../state/prefs.js';
import { loadPlatforms, platforms, invalidatePosts } from '../../state/social.js';
import { Alert, Button, Field, Icon, IconButton, Input, Segmented, Select, SkeletonList, Textarea } from '../../components/ui.js';
import { confirm } from '../../components/overlay.js';
import { toast } from '../../components/toast.js';
import { SortableList } from '../../components/sortable.js';
import { CropDialog, DropZone, MediaPicker, UploadList, uploadFiles } from '../../components/media-picker.js';
import { PlatformIcon } from '../../components/platform-icon.js';
import { isCompact } from '../../components/media-query.js';
import { addDays, fmtBytes, isPastMoment, nextFullHour, today } from '../../time.js';
import { captionState, checkItem, checkList, kindOfUrl, maxItems, scheduleBlockers } from '/shared/rules/media-rules.js';
import { isHttpsUrl, isShareLink } from '/shared/rules/validate.js';
import { testShareLink } from './views.js';
import { StandardsCard } from './standards-card.js';

/**
 * @typedef {{key: string, media_id?: string, media?: any, url?: string}} MediaItem
 * @typedef {{platform_id: string, format_id: string, publish_date: string, publish_time: string, title: string, caption: string,
 *   status: 'draft'|'scheduled'|'published', media: MediaItem[], share_link: string, event_id: string|null, event?: any}} PostForm
 */

let seq = 0;
const key = () => `m${++seq}`;

/** @param {any} m @returns {MediaItem} */
const toItem = (m) => (m.media_id ? { key: key(), media_id: m.media_id, media: m.media } : { key: key(), url: m.url });

/** Load an external URL to learn its size (and duration for videos). @param {string} url */
export function probeUrl(url) {
  const kind = kindOfUrl(url);
  return new Promise((resolve) => {
    const done = (/** @type {any} */ info) => resolve({ kind, ...info });
    const timer = setTimeout(() => done({ failed: true }), 10000);
    if (kind === 'video') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => (clearTimeout(timer), done({ width: v.videoWidth, height: v.videoHeight, duration_s: v.duration }));
      v.onerror = () => (clearTimeout(timer), done({ failed: true }));
      v.src = url;
    } else {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => (clearTimeout(timer), done({ width: img.naturalWidth, height: img.naturalHeight }));
      img.onerror = () => (clearTimeout(timer), done({ failed: true }));
      img.src = url;
    }
  });
}

/** What the rules know about an item. @param {MediaItem} it @param {Record<string, any>} probes */
function infoOf(it, probes) {
  if (it.media) return { kind: it.media.kind, width: it.media.width, height: it.media.height, duration_s: it.media.duration_s, bytes: it.media.bytes };
  const p = it.url ? probes[it.url] : null;
  return { kind: kindOfUrl(it.url ?? ''), ...(p && !p.failed ? { width: p.width, height: p.height, duration_s: p.duration_s } : {}) };
}

/** Default platform for a new post: the tab in view, else the last used, else the first enabled one. @param {any[]} list @param {string} [hint] */
function defaultPlatform(list, hint) {
  const enabled = list.filter((p) => p.enabled);
  return enabled.find((p) => p.id === hint) ?? enabled.find((p) => p.id === store.get('social.lastPlatform')) ?? enabled[0] ?? list[0];
}

/**
 * The next full hour with no other post at that time.
 * @param {any[]} posts
 */
export function nextFreeHour(posts) {
  let { date, time } = nextFullHour();
  const taken = new Set(posts.map((p) => `${p.publish_date} ${p.publish_time}`));
  for (let i = 0; i < 24 * 14 && taken.has(`${date} ${time}`); i++) {
    const h = Number(time.slice(0, 2)) + 1;
    if (h >= 24) {
      date = addDays(date, 1);
      time = '00:00';
    } else time = `${String(h).padStart(2, '0')}:00`;
  }
  return { date, time };
}

/**
 * @param {{id?: string|null, on?: string|null, dup?: string|null, eventId?: string|null, platformHint?: string, prefill?: Partial<PostForm>|null,
 *   onDone: (saved: any|null, next?: {dup?: string}) => void, onTitle: (s: string) => void}} p
 */
export function PostEditor({ id, on, dup, eventId, platformHint, prefill, onDone, onTitle }) {
  const [form, setForm] = useState(/** @type {PostForm|null} */ (null));
  const [version, setVersion] = useState(/** @type {number|null} */ (null));
  const [original, setOriginal] = useState(/** @type {{date: string, time: string}|null} */ (null));
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [blockers, setBlockers] = useState(/** @type {any[]} */ ([]));
  const [busy, setBusy] = useState(/** @type {string|null} */ (null));
  const [probes, setProbes] = useState(/** @type {Record<string, any>} */ ({}));
  const [uploads, setUploads] = useState(/** @type {any[]} */ ([]));
  const [libOpen, setLibOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [cropItem, setCropItem] = useState(/** @type {MediaItem|null} */ (null));
  const [cardOpen, setCardOpen] = useState(/** @type {boolean} */ (store.get('social.standardsOpen') ?? !isCompact.value));

  useEffect(() => {
    onTitle(id ? t('social.editPost') : t('social.newPost'));
    let live = true;
    (async () => {
      await loadPlatforms();
      const list = platforms.value ?? [];
      if (id || dup) {
        const p = await api('GET', `/posts/${id ?? dup}`);
        if (!live) return;
        /** @type {PostForm} */
        const f = {
          platform_id: p.platform_id, format_id: p.format_id, publish_date: p.publish_date, publish_time: p.publish_time, title: p.title,
          caption: p.caption, status: p.status, media: p.media.map(toItem), share_link: p.share_link ?? '', event_id: p.event_id, event: p.event,
        };
        if (dup) {
          const soon = await api('GET', '/posts', { query: { from: today(), to: addDays(today(), 14) } });
          const slot = nextFreeHour(soon.items);
          Object.assign(f, { publish_date: slot.date, publish_time: slot.time, status: 'draft' });
          if (!list.find((x) => x.id === f.platform_id)?.enabled) {
            const d = defaultPlatform(list);
            Object.assign(f, { platform_id: d.id, format_id: d.formats[0].id });
          }
        } else {
          setVersion(p.version);
          setOriginal({ date: p.publish_date, time: p.publish_time });
        }
        setForm(f);
        return;
      }
      if (eventId) {
        // "Creează postare" from the promotion queue: the server builds the draft.
        const d = await api('GET', `/promotions/${eventId}/draft`);
        if (!live) return;
        const pl = list.find((p) => p.id === d.platform_id) ?? defaultPlatform(list);
        setForm({
          platform_id: pl.id, format_id: d.format_id ?? pl.formats[0].id, publish_date: d.publish_date, publish_time: d.publish_time, title: d.title,
          caption: d.caption, status: 'draft', media: d.media.map(toItem), share_link: '', event_id: d.event_id, event: d.event,
        });
        return;
      }
      const pl = defaultPlatform(list, prefill?.platform_id ?? platformHint);
      const nh = nextFullHour();
      const date = on && on > nh.date ? on : nh.date;
      setForm({
        platform_id: pl.id, format_id: pl.formats[0].id, publish_date: date, publish_time: date === nh.date ? nh.time : '10:00', title: '', caption: '',
        status: 'draft', media: [], share_link: '', event_id: null, ...prefill,
        ...(prefill?.media ? { media: prefill.media.map(toItem) } : {}),
      });
    })().catch((err) => {
      toast('danger', errorText(err.code));
      onDone(null);
    });
    return () => {
      live = false;
    };
  }, [id, dup, eventId]);

  // Probe external URLs once.
  useEffect(() => {
    for (const it of form?.media ?? []) {
      if (it.url && isHttpsUrl(it.url) && !(it.url in probes)) {
        setProbes((p) => ({ ...p, [/** @type {string} */ (it.url)]: { pending: true } }));
        probeUrl(it.url).then((info) => setProbes((p) => ({ ...p, [/** @type {string} */ (it.url)]: info })));
      }
    }
  }, [form?.media]);

  const list = platforms.value ?? [];
  const platform = list.find((p) => p.id === form?.platform_id);
  const format = platform?.formats.find((/** @type {any} */ f) => f.id === form?.format_id) ?? platform?.formats[0];
  const infos = useMemo(() => (form?.media ?? []).map((it) => infoOf(it, probes)), [form?.media, probes]);
  const cap = format && form ? captionState(format, form.caption) : null;
  const block = format && form ? scheduleBlockers(format, infos, form.caption) : [];
  const moved = !original || original.date !== form?.publish_date || original.time !== form?.publish_time;
  const pastBlocked = !!form && moved && form.status !== 'published' && isPastMoment(form.publish_date, form.publish_time);

  if (!form || !platform || !format) return html`<${SkeletonList} rows=${5} />`;

  /** @param {Partial<PostForm>} patch */
  const set = (patch) => {
    setForm((f) => ({ .../** @type {PostForm} */ (f), ...patch }));
    setErrors((e) => {
      const n = { ...e };
      for (const k of Object.keys(patch)) delete n[k];
      return n;
    });
    setBlockers([]);
  };
  /** @param {MediaItem[]} items */
  const addMedia = (items) => {
    const max = maxItems(format);
    const next = max === 1 ? items.slice(-1) : [...form.media, ...items];
    set({ media: next });
  };
  /** @param {File[]} files */
  const onFiles = async (files) => {
    const done = await uploadFiles(files, setUploads);
    if (done.length) addMedia(done.map((m) => ({ key: key(), media_id: m.id, media: m })));
    if (done.length === files.length) setUploads([]);
  };
  const addUrl = () => {
    const u = urlDraft.trim();
    if (!isHttpsUrl(u)) return setErrors((e) => ({ ...e, mediaUrl: 'invalid_https_url' }));
    addMedia([{ key: key(), url: u }]);
    setUrlDraft('');
  };

  const platformOptions = list
    .filter((p) => p.enabled || p.id === form.platform_id)
    .map((p) => ({ value: p.id, label: p.enabled ? p.name : `${p.name} ${t('social.disabledSuffix')}` }));

  async function save(/** @type {'save'|'dup'} */ mode) {
    const f = /** @type {PostForm} */ (form);
    /** @type {Record<string, string>} */ const errs = {};
    if (!f.title.trim()) errs.title = 'required';
    if (!f.publish_date) errs.publish_date = 'required';
    if (!f.publish_time) errs.publish_time = 'required';
    if (pastBlocked) errs.publish_date = 'post_in_past';
    if (f.share_link.trim() && !isShareLink(f.share_link.trim())) errs.share_link = 'invalid_share_link';
    setErrors(errs);
    if (Object.keys(errs).length) return focusFirstError();
    if (f.status === 'scheduled' && block.length) {
      setBlockers(block);
      return;
    }
    setBusy(mode);
    const payload = {
      platform_id: f.platform_id, format_id: format.id, publish_date: f.publish_date, publish_time: f.publish_time, title: f.title.trim(),
      caption: f.caption, status: f.status, media: f.media.map((m) => (m.media_id ? { media_id: m.media_id } : { url: m.url })),
      share_link: f.share_link.trim() || null, event_id: f.event_id,
    };
    try {
      const saved = id ? await api('PATCH', `/posts/${id}`, { body: payload, version: version ?? undefined }) : await api('POST', '/posts', { body: payload });
      store.set('social.lastPlatform', saved.platform_id);
      invalidatePosts();
      toast('success', id ? t('social.saved') : t('social.created'));
      onDone(saved, mode === 'dup' ? { dup: saved.id } : undefined);
    } catch (/** @type {any} */ err) {
      if (err instanceof ApiError && err.code === 'post_not_ready') setBlockers(err.details?.blockers ?? []);
      else if (err instanceof ApiError && err.details?.fields) {
        setErrors(err.details.fields);
        focusFirstError();
      } else toast('danger', errorText(err.code));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({ title: t('social.deleteTitle'), message: t('social.deleteText', { title: form?.title ?? '' }), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return;
    try {
      await api('DELETE', `/posts/${id}`, { version: version ?? undefined });
      invalidatePosts();
      toast('success', t('social.deleted'));
      onDone(null);
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    }
  }

  const err = (/** @type {string} */ k) => (errors[k] ? t(`errors.${errors[k]}`) : null);
  const kindForPicker = format.media_kind === 'carousel' ? null : format.media_kind;
  const canAdd = format.media_kind === 'carousel' ? form.media.length < maxItems(format) : form.media.length === 0;

  return html`<form class="post-editor stack" noValidate onSubmit=${(/** @type {Event} */ e) => (e.preventDefault(), save('save'))}>
    ${form.event && html`<${Alert} tone="info" icon="megaphone">
      <span>${t('social.promotesEvent', { title: form.event.title })}</span>
      <button type="button" class="btn btn--ghost btn--sm" onClick=${() => set({ event_id: null, event: null })}>${t('social.unlinkEvent')}</button>
    </${Alert}>`}

    <div class="field-row">
      <${Field} label=${t('social.platform')} required error=${err('platform_id')}>
        ${(/** @type {any} */ a) => html`<div class="input-group">
          <span class="input-lead"><${PlatformIcon} platform=${platform} size=${18} /></span>
          <${Select} ...${a} value=${form.platform_id} options=${platformOptions}
            onChange=${(/** @type {string} */ v) => set({ platform_id: v, format_id: list.find((p) => p.id === v)?.formats[0]?.id ?? '' })} />
        </div>`}
      </${Field}>
      <${Field} label=${t('social.format')} required error=${err('format_id')}>
        ${(/** @type {any} */ a) => html`<${Select} ...${a} value=${format.id} onChange=${(/** @type {string} */ v) => set({ format_id: v })}
          options=${platform.formats.map((/** @type {any} */ f) => ({ value: f.id, label: f.name }))} />`}
      </${Field}>
    </div>

    <${StandardsCard} format=${format} open=${cardOpen} onToggle=${(/** @type {boolean} */ o) => (setCardOpen(o), store.set('social.standardsOpen', o))} />

    <div class="field-row">
      <${Field} label=${t('social.publishDate')} required error=${err('publish_date')}>
        ${(/** @type {any} */ a) => html`<${Input} ...${a} type="date" value=${form.publish_date} onInput=${(/** @type {string} */ v) => set({ publish_date: v })} />`}
      </${Field}>
      <${Field} label=${t('social.publishTime')} required error=${err('publish_time')}>
        ${(/** @type {any} */ a) => html`<${Input} ...${a} type="time" step="300" value=${form.publish_time} onInput=${(/** @type {string} */ v) => set({ publish_time: v })} />`}
      </${Field}>
    </div>
    ${pastBlocked && !errors.publish_date && html`<p class="small text-warning"><${Icon} name="triangle-alert" /> ${t('social.pastHint')}</p>`}

    <${Field} label=${t('social.title')} hint=${t('social.titleHint')} required error=${err('title')} id="p-title">
      ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${form.title} maxLength="200" onInput=${(/** @type {string} */ v) => set({ title: v })} />`}
    </${Field}>

    <fieldset class="field post-media">
      <legend class="field-label">${t('social.media')}
        <span class="muted small"> · ${format.media_kind === 'carousel' ? t('social.mediaUpTo', { n: maxItems(format) }) : t(`social.kind_${format.media_kind}`)}</span></legend>
      ${form.media.length > 0 && html`<${SortableList} items=${form.media.map((m) => ({ ...m, id: m.key }))} label=${(/** @type {any} */ m) => m.media?.original_name ?? m.url ?? ''}
        disabled=${form.media.length < 2}
        onReorder=${(/** @type {string[]} */ ids) => set({ media: ids.map((k) => /** @type {MediaItem} */ (form.media.find((m) => m.key === k))) })}
        render=${(/** @type {any} */ m, /** @type {number} */ i) => html`<${MediaRow} item=${m} info=${infos[i]} probe=${m.url ? probes[m.url] : null} format=${format}
          onRemove=${() => set({ media: form.media.filter((x) => x.key !== m.key) })} onCrop=${() => setCropItem(m)} />`} />`}
      ${checkList(format, form.media.length).map((c) => html`<p class="small text-danger"><${Icon} name="circle-x" /> ${t(`social.check_${c.code}`, c.params)}</p>`)}
      ${canAdd && html`<div class="post-media-add">
        <${DropZone} kind=${kindForPicker} multiple=${format.media_kind === 'carousel'} compact onFiles=${onFiles} id="p-media-file" />
        <${Button} icon="images" onClick=${() => setLibOpen(true)}>${t('media.fromLibrary')}</${Button}>
      </div>
      <div class="cluster">
        <input class="input grow" type="url" inputMode="url" placeholder="https://…" value=${urlDraft} aria-label=${t('social.mediaUrl')}
          aria-invalid=${errors.mediaUrl ? 'true' : undefined}
          onInput=${(/** @type {any} */ e) => (setUrlDraft(e.currentTarget.value), setErrors((x) => ({ ...x, mediaUrl: '' })))}
          onKeyDown=${(/** @type {KeyboardEvent} */ e) => e.key === 'Enter' && (e.preventDefault(), addUrl())} />
        <${Button} size="sm" icon="link" onClick=${addUrl}>${t('social.addUrl')}</${Button}>
      </div>
      ${errors.mediaUrl && html`<div class="field-error"><${Icon} name="circle-alert" />${t(`errors.${errors.mediaUrl}`)}</div>`}`}
      <${UploadList} items=${uploads} />
    </fieldset>

    <${Field} label=${t('social.shareLink')} hint=${t('social.shareLinkHint')} error=${err('share_link')}>
      ${(/** @type {any} */ a) => html`<div class="cluster">
        <${Input} ...${a} class="grow" value=${form.share_link} placeholder="https://… / \\\\server\\share" onInput=${(/** @type {string} */ v) => set({ share_link: v })} />
        <${Button} size="sm" icon="external-link" disabled=${!isShareLink(form.share_link.trim())} onClick=${() => testShareLink(form.share_link.trim())}>${t('social.test')}</${Button}>
      </div>`}
    </${Field}>

    <${Field} label=${t('social.caption')} error=${cap?.level === 'over' ? t('social.check_caption_too_long', { n: cap.n, max: cap.limit }) : null}
      hint=${cap?.hook != null ? t('social.hookHint', { n: cap.hook }) : null}
      counter=${cap ? { n: cap.n, max: cap.limit, warnAt: cap.hook } : undefined}>
      ${(/** @type {any} */ a) => html`<${Textarea} ...${a} rows="6" value=${form.caption} onInput=${(/** @type {string} */ v) => set({ caption: v })} />`}
    </${Field}>

    <div class="field">
      <span class="field-label" id="p-status">${t('social.status')}</span>
      <${Segmented} label=${t('social.status')} value=${form.status} onChange=${(/** @type {any} */ v) => set({ status: v })}
        options=${['draft', 'scheduled', 'published'].map((s) => ({ value: s, label: t(`social.status_${s}`) }))} />
      ${form.status === 'scheduled' && block.length > 0 && blockers.length === 0 &&
      html`<p class="small text-warning"><${Icon} name="triangle-alert" /> ${t('social.scheduleBlocked')}</p>`}
    </div>

    ${blockers.length > 0 && html`<${Alert} tone="danger" title=${t('social.notReadyTitle')}>
      <ul class="plain-list">${blockers.map((b) => html`<li>${b.params?.index != null ? `#${b.params.index + 1}: ` : ''}${t(`social.check_${b.code}`, b.params)}</li>`)}</ul>
      <p>${t('social.notReadyText')}</p>
    </${Alert}>`}

    <div class="form-actions post-editor-actions">
      ${id && html`<${Button} variant="danger-ghost" icon="trash-2" onClick=${remove} class="me-auto">${t('common.delete')}</${Button}>`}
      <${Button} onClick=${() => onDone(null)}>${t('common.cancel')}</${Button}>
      <${Button} busy=${busy === 'dup'} disabled=${!!busy} onClick=${() => save('dup')}>${t('social.saveAndDuplicate')}</${Button}>
      <${Button} variant="primary" type="submit" busy=${busy === 'save'} disabled=${!!busy}>${t('common.save')}</${Button}>
    </div>

    <${MediaPicker} open=${libOpen} onClose=${() => setLibOpen(false)} kind=${kindForPicker} multiple=${format.media_kind === 'carousel'} initialTab="library"
      onPick=${(/** @type {any[]} */ items) => addMedia(items.map((m) => ({ key: key(), media_id: m.id, media: m })))} />
    ${cropItem?.media && html`<${CropDialog} open=${!!cropItem} onClose=${() => setCropItem(null)} media=${cropItem.media} ratio=${format.ratio_w / format.ratio_h}
      title=${t('social.cropTo', { ratio: format.ratio })}
      onDone=${(/** @type {any} */ m) => set({ media: form.media.map((x) => (x.key === cropItem.key ? { key: key(), media_id: m.id, media: m } : x)) })} />`}
  </form>`;
}

function focusFirstError() {
  requestAnimationFrame(() => /** @type {HTMLElement|null} */ (document.querySelector('.post-editor [aria-invalid="true"]'))?.focus());
}

/**
 * One media item with its validation: ✓ / ⚠ / ✗ and the reasons.
 * @param {{item: MediaItem, info: any, probe: any, format: any, onRemove: () => void, onCrop: () => void}} p
 */
function MediaRow({ item, info, probe, format, onRemove, onCrop }) {
  const res = checkItem(format, info);
  const pending = item.url && (!probe || probe.pending);
  const failed = item.url && probe?.failed;
  const thumb = item.media ? item.media.thumb_url ?? (item.media.kind === 'image' ? item.media.url : null) : info.kind === 'image' && !failed ? item.url : null;
  const name = item.media?.original_name ?? item.url;
  const meta = [
    info.width && info.height ? `${info.width} × ${info.height}` : null,
    info.duration_s != null ? `${Math.round(info.duration_s)} s` : null,
    info.bytes != null ? fmtBytes(info.bytes) : null,
  ].filter(Boolean);
  const canCrop = item.media?.kind === 'image' && res.checks.some((c) => c.code === 'ratio_off');
  return html`<div class="media-row" data-level=${res.level}>
    <div class="media-row-thumb">${thumb ? html`<img src=${thumb} alt="" referrerpolicy="no-referrer" />` : html`<${Icon} name=${info.kind === 'video' ? 'video' : 'image'} />`}</div>
    <div class="media-row-main">
      <div class="media-row-name" title=${name}>${name}</div>
      <div class="small muted num">${meta.join(' · ') || (pending ? t('social.checking') : failed ? t('social.urlNotLoaded') : '')}</div>
      <ul class="media-checks">
        ${res.checks.length === 0 && !pending && !failed && html`<li data-level="ok"><${Icon} name="circle-check" />${t('social.checkOk')}</li>`}
        ${res.checks.map((c) => html`<li data-level=${c.level}><${Icon} name=${c.level === 'error' ? 'circle-x' : 'triangle-alert'} />${t(`social.check_${c.code}`, c.params)}</li>`)}
      </ul>
    </div>
    <div class="media-row-actions">
      ${canCrop && html`<${Button} size="sm" icon="crop" onClick=${onCrop}>${t('social.crop')}</${Button}>`}
      <${IconButton} icon="x" label=${t('social.removeMedia', { name })} onClick=${onRemove} />
    </div>
  </div>`;
}
