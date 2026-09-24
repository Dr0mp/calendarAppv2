import { html, useEffect, useRef, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { api, ApiError, errorText } from '../../api.js';
import { usePageChrome } from '../../state/chrome.js';
import { loadPlatforms, platforms, setPlatforms, invalidatePosts } from '../../state/social.js';
import { Alert, Badge, Button, EmptyState, Field, Icon, IconButton, Input, RadioGroup, Select, SkeletonList, Switch, Textarea } from '../../components/ui.js';
import { Modal, Popover, MenuItem, confirm, menuKeys } from '../../components/overlay.js';
import { SortableList } from '../../components/sortable.js';
import { DropZone, UploadList, uploadFiles } from '../../components/media-picker.js';
import { PlatformIcon } from '../../components/platform-icon.js';
import { toast } from '../../components/toast.js';
import { KIND_ICON } from './views.js';

export default function Platforms() {
  usePageChrome(t('social.platforms'));
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const [format, setFormat] = useState(/** @type {{platform: any, format: any}|null} */ (null));
  const [deleting, setDeleting] = useState(/** @type {any} */ (null));
  const [preview, setPreview] = useState(/** @type {{doc: any, diff: any}|null} */ (null));
  const fileRef = useRef(/** @type {HTMLInputElement|null} */ (null));
  const items = platforms.value;

  useEffect(() => {
    loadPlatforms(true);
  }, []);
  const reload = () => loadPlatforms(true);

  /** @param {string[]} ids */
  async function reorder(ids) {
    setPlatforms(ids.map((id) => /** @type {any[]} */ (items).find((x) => x.id === id)));
    try {
      setPlatforms((await api('POST', '/platforms/reorder', { body: { ids } })).items);
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
      reload();
    }
  }

  /** @param {any} p */
  async function toggle(p) {
    try {
      await api('PATCH', `/platforms/${p.id}`, { body: { enabled: !p.enabled }, version: p.version });
      toast('success', p.enabled ? t('social.platformDisabled', { name: p.name }) : t('social.platformEnabled', { name: p.name }));
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    }
    reload();
  }

  /** @param {any} p */
  async function removePlatform(p) {
    if (p.post_count > 0) return setDeleting(p);
    if (items && items.length <= 1) return toast('warning', t('errors.last_platform'));
    const ok = await confirm({ title: t('social.deletePlatformTitle', { name: p.name }), message: t('social.deletePlatformText'), danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    try {
      await api('DELETE', `/platforms/${p.id}`, { version: p.version });
      toast('success', t('social.platformDeleted', { name: p.name }));
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    }
    reload();
  }

  /** @param {any} p @param {any} f */
  async function removeFormat(p, f) {
    if (p.formats.length <= 1) return toast('warning', t('errors.last_format'));
    /** @type {any} */ let body;
    if (f.post_count > 0) {
      const moveTo = await confirm({
        title: t('social.deleteFormatTitle', { name: f.name }),
        message: t('social.formatInUse', { n: f.post_count }),
        confirmLabel: t('social.moveAndDelete'),
        danger: true,
        choices: p.formats.filter((/** @type {any} */ x) => x.id !== f.id).map((/** @type {any} */ x) => ({ value: x.id, label: x.name, hint: `${x.ratio} · ${t(`social.kind_${x.media_kind}`)}` })),
      });
      if (!moveTo) return;
      body = { moveTo };
    } else {
      const ok = await confirm({ title: t('social.deleteFormatTitle', { name: f.name }), message: t('social.deleteFormatText'), danger: true, confirmLabel: t('common.delete') });
      if (!ok) return;
    }
    try {
      await api('DELETE', `/platforms/${p.id}/formats/${f.id}`, { version: f.version, body });
      toast('success', t('social.formatDeleted', { name: f.name }));
      if (body) invalidatePosts();
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    }
    reload();
  }

  /** @param {any} p @param {number} i @param {number} dir */
  async function moveFormat(p, i, dir) {
    const ids = p.formats.map((/** @type {any} */ f) => f.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api('POST', `/platforms/${p.id}/formats/reorder`, { body: { ids } });
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    }
    reload();
  }

  async function exportJson(/** @type {boolean} */ promotions) {
    try {
      const doc = await api('GET', '/social/export', { query: promotions ? { promotions: '1' } : {} });
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `social-${doc.exportedAt.slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    }
  }

  /** @param {File} file */
  async function importFile(file) {
    /** @type {any} */ let doc;
    try {
      doc = JSON.parse(await file.text());
    } catch {
      return toast('danger', t('social.importNotJson'));
    }
    try {
      const r = await api('POST', '/social/import', { query: { dryRun: '1' }, body: doc });
      setPreview({ doc, diff: r.diff });
    } catch (/** @type {any} */ err) {
      const where = err instanceof ApiError ? Object.keys(err.fields).join(', ') : '';
      toast('danger', err instanceof ApiError && err.status === 400 ? t('social.importInvalid', { where: where || '—' }) : errorText(err.code));
    }
  }

  async function reset() {
    const ok = await confirm({ title: t('social.resetTitle'), message: t('social.resetText'), confirmLabel: t('social.reset'), danger: true });
    if (!ok) return;
    try {
      setPlatforms((await api('POST', '/platforms/reset', { body: {} })).items);
      toast('success', t('social.resetDone'));
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    }
  }

  return html`<div class="stack platforms-page">
    <div class="page-head">
      <h1>${t('social.platforms')}</h1>
      <div class="cluster">
        <a class="btn btn--secondary" href="/social/standards"><${Icon} name="badge-check" />${t('social.standards')}</a>
        <${Popover} label=${t('social.moreActions')} align="end" trigger=${(/** @type {any} */ p) => html`<button type="button" class="btn btn--secondary" ref=${p.ref}
          aria-expanded=${p['aria-expanded']} aria-haspopup="menu" onClick=${p.toggle}><${Icon} name="ellipsis" />${t('social.moreActions')}</button>`}>
          ${(/** @type {() => void} */ close) => html`<div role="menu" class="menu" onKeyDown=${menuKeys}>
            <${MenuItem} icon="download" onClick=${() => (close(), exportJson(false))}>${t('social.export')}</${MenuItem}>
            <${MenuItem} icon="download" onClick=${() => (close(), exportJson(true))}>${t('social.exportWithPromotions')}</${MenuItem}>
            <${MenuItem} icon="upload" onClick=${() => (close(), fileRef.current?.click())}>${t('social.import')}</${MenuItem}>
            <${MenuItem} icon="rotate-ccw" danger onClick=${() => (close(), reset())}>${t('social.resetDefaults')}</${MenuItem}>
          </div>`}
        </${Popover}>
        <${Button} variant="primary" icon="plus" onClick=${() => setEditing({})}>${t('social.addPlatform')}</${Button}>
      </div>
      <p class="page-sub">${t('social.platformsIntro')}</p>
      <input type="file" accept="application/json,.json" class="sr-only" ref=${fileRef} tabindex="-1" aria-hidden="true"
        onChange=${(/** @type {any} */ e) => {
          const f = e.currentTarget.files[0];
          e.currentTarget.value = '';
          if (f) importFile(f);
        }} />
    </div>
    ${items === null
      ? html`<${SkeletonList} rows=${3} />`
      : items.length === 0
        ? html`<${EmptyState} icon="layers" title=${t('social.noPlatforms')} text="" />`
        : html`<${SortableList} items=${items} onReorder=${reorder} label=${(/** @type {any} */ p) => p.name} class="platform-list"
            render=${(/** @type {any} */ p) => html`<${PlatformCard} p=${p} onToggle=${() => toggle(p)} onEdit=${() => setEditing(p)} onDelete=${() => removePlatform(p)}
              onAddFormat=${() => setFormat({ platform: p, format: {} })} onEditFormat=${(/** @type {any} */ f) => setFormat({ platform: p, format: f })}
              onDeleteFormat=${(/** @type {any} */ f) => removeFormat(p, f)} onMoveFormat=${(/** @type {number} */ i, /** @type {number} */ d) => moveFormat(p, i, d)} />`} />`}
    ${editing && html`<${PlatformDialog} platform=${editing} onClose=${() => setEditing(null)} onDone=${() => (setEditing(null), reload())} />`}
    ${format && html`<${FormatDialog} platform=${format.platform} format=${format.format} onClose=${() => setFormat(null)} onDone=${() => (setFormat(null), reload())} />`}
    ${deleting && html`<${DeletePlatformDialog} platform=${deleting} all=${items ?? []} onClose=${() => setDeleting(null)}
      onDone=${() => (setDeleting(null), invalidatePosts(), reload())} />`}
    ${preview && html`<${ImportPreview} diff=${preview.diff} onClose=${() => setPreview(null)}
      onConfirm=${async () => {
        try {
          await api('POST', '/social/import', { body: preview.doc });
          toast('success', t('social.importDone'));
          setPreview(null);
          invalidatePosts();
          reload();
        } catch (/** @type {any} */ err) {
          toast('danger', errorText(err.code));
        }
      }} />`}
  </div>`;
}

/**
 * @param {{p: any, onToggle: () => void, onEdit: () => void, onDelete: () => void, onAddFormat: () => void,
 *   onEditFormat: (f: any) => void, onDeleteFormat: (f: any) => void, onMoveFormat: (i: number, d: number) => void}} props
 */
function PlatformCard({ p, onToggle, onEdit, onDelete, onAddFormat, onEditFormat, onDeleteFormat, onMoveFormat }) {
  return html`<section class="platform-card" aria-labelledby=${`pl-${p.id}`} data-enabled=${p.enabled ? 'true' : 'false'}>
    <div class="platform-card-head">
      <${PlatformIcon} platform=${p} size=${32} />
      <div class="grow">
        <div class="cluster" style=${{ '--cluster-gap': 'var(--space-2)' }}>
          <h2 id=${`pl-${p.id}`}>${p.name}</h2>
          ${!p.enabled && html`<${Badge}>${t('social.disabled')}</${Badge}>`}
        </div>
        <div class="small muted platform-meta">
          <span><span class="status-dot" style=${{ background: p.color }} aria-hidden="true"></span><code>${p.color}</code></span>
          ${p.domain && html`<span><${Icon} name="globe" /> ${p.domain}</span>`}
          <span>${t('social.nPosts', { n: p.post_count })}</span>
        </div>
      </div>
      <${Switch} checked=${p.enabled} onChange=${onToggle} label=${html`<span class="sr-only">${t('social.enabledName', { name: p.name })}</span>`} />
      <${IconButton} icon="pencil" label=${t('common.editName', { name: p.name })} onClick=${onEdit} />
      <${IconButton} icon="trash-2" label=${t('common.deleteName', { name: p.name })} onClick=${onDelete} />
    </div>
    ${p.description && html`<p class="small">${p.description}</p>`}
    <div class="table-wrap">
      <table class="table format-table">
        <caption class="sr-only">${t('social.formatsOf', { name: p.name })}</caption>
        <thead><tr>
          <th scope="col">${t('social.format')}</th><th scope="col">${t('social.std_kind')}</th><th scope="col">${t('social.std_ratio')}</th>
          <th scope="col">${t('social.std_resolution')}</th><th scope="col">${t('social.std_caption')}</th><th scope="col">${t('social.posts')}</th>
          <th scope="col"><span class="sr-only">${t('common.actions')}</span></th>
        </tr></thead>
        <tbody>
          ${p.formats.map((/** @type {any} */ f, /** @type {number} */ i) => html`<tr>
            <th scope="row">${f.name}</th>
            <td><span class="nowrap"><${Icon} name=${KIND_ICON[/** @type {'video'} */ (f.media_kind)]} /> ${t(`social.kind_${f.media_kind}`)}</span></td>
            <td class="num">${f.ratio}</td>
            <td class="num">${f.width} × ${f.height}</td>
            <td class="num">${f.caption_limit}</td>
            <td class="num">${f.post_count}</td>
            <td class="table-actions">
              <${IconButton} icon="chevron-up" size="sm" label=${t('common.moveUpName', { name: f.name })} disabled=${i === 0} onClick=${() => onMoveFormat(i, -1)} />
              <${IconButton} icon="chevron-down" size="sm" label=${t('common.moveDownName', { name: f.name })} disabled=${i === p.formats.length - 1} onClick=${() => onMoveFormat(i, 1)} />
              <${IconButton} icon="pencil" size="sm" label=${t('common.editName', { name: f.name })} onClick=${() => onEditFormat(f)} />
              <${IconButton} icon="trash-2" size="sm" label=${t('common.deleteName', { name: f.name })} onClick=${() => onDeleteFormat(f)} />
            </td>
          </tr>`)}
        </tbody>
      </table>
    </div>
    <div><${Button} size="sm" icon="plus" onClick=${onAddFormat}>${t('social.addFormat')}</${Button}></div>
  </section>`;
}

/** @param {{platform: any, onClose: () => void, onDone: () => void}} p */
function PlatformDialog({ platform, onClose, onDone }) {
  const isNew = !platform.id;
  const [f, setF] = useState({
    name: platform.name ?? '', color: platform.color ?? '#0f766e', domain: platform.domain ?? '', description: platform.description ?? '',
    icon_media_id: platform.icon_media_id ?? null, enabled: platform.enabled ?? true,
  });
  const [icon, setIcon] = useState(/** @type {string|null} */ (platform.icon_media_id ? `/media/${platform.icon_media_id}/original` : null));
  const [uploads, setUploads] = useState(/** @type {any[]} */ ([]));
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [busy, setBusy] = useState(false);
  /** @param {string} k @param {any} v */
  const set = (k, v) => setF({ ...f, [k]: v });

  /** @param {Event} e */
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      if (isNew) await api('POST', '/platforms', { body: f });
      else await api('PATCH', `/platforms/${platform.id}`, { body: f, version: platform.version });
      toast('success', t('common.saved'));
      onDone();
    } catch (/** @type {any} */ err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, t(`errors.${v}`)])));
      else toast('danger', errorText(err.code));
    } finally {
      setBusy(false);
    }
  }

  return html`<${Modal} open onClose=${onClose} title=${isNew ? t('social.addPlatform') : t('common.editName', { name: platform.name })}
    footer=${html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
      <${Button} variant="primary" type="submit" form="platform-form" busy=${busy}>${t('common.save')}</${Button}>`}>
    <form id="platform-form" class="stack" onSubmit=${submit} noValidate>
      <${Field} label=${t('social.platformName')} error=${errors.name} required>
        ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f.name} maxLength="60" onInput=${(/** @type {string} */ v) => set('name', v)} />`}
      </${Field}>
      <div class="field-row">
        <${Field} label=${t('social.brandColor')} error=${errors.color} required>
          ${(/** @type {any} */ a) => html`<div class="cluster">
            <input type="color" class="color-input" value=${f.color} aria-label=${t('social.brandColorPicker')} onInput=${(/** @type {any} */ e) => set('color', e.currentTarget.value)} />
            <${Input} ...${a} class="grow" value=${f.color} maxLength="7" onInput=${(/** @type {string} */ v) => set('color', v)} />
          </div>`}
        </${Field}>
        <${Field} label=${t('social.domain')} hint=${t('social.domainHint')} error=${errors.domain}>
          ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f.domain} placeholder="exemplu.ro" inputMode="url" onInput=${(/** @type {string} */ v) => set('domain', v)} />`}
        </${Field}>
      </div>
      <${Field} label=${t('social.platformDescription')} error=${errors.description}>
        ${(/** @type {any} */ a) => html`<${Textarea} ...${a} rows="2" value=${f.description} onInput=${(/** @type {string} */ v) => set('description', v)} />`}
      </${Field}>
      <div class="field">
        <span class="field-label">${t('social.icon')}</span>
        <p class="field-hint">${t('social.iconHint')}</p>
        <div class="cluster">
          <${PlatformIcon} platform=${{ name: f.name || '?', color: f.color, icon_url: icon ?? (isNew ? null : platform.icon_url) }} size=${40} />
          <${DropZone} kind="image" compact id="platform-icon-file" onFiles=${async (/** @type {File[]} */ files) => {
            const [m] = await uploadFiles(files.slice(0, 1), setUploads);
            if (m) (set('icon_media_id', m.id), setIcon(m.url), setUploads([]));
          }} />
          ${f.icon_media_id && html`<${Button} size="sm" variant="ghost" onClick=${() => (set('icon_media_id', null), setIcon(null))}>${t('common.remove')}</${Button}>`}
        </div>
        <${UploadList} items=${uploads} />
      </div>
      <${Switch} checked=${f.enabled} onChange=${(/** @type {boolean} */ v) => set('enabled', v)} label=${t('social.enabledHint')} />
      ${isNew && html`<p class="small muted">${t('social.newPlatformFormats')}</p>`}
    </form>
  </${Modal}>`;
}

const FORMAT_NUMBERS = /** @type {const} */ (['ratio_w', 'ratio_h', 'width', 'height', 'min_duration_s', 'max_duration_s', 'max_items', 'max_file_mb', 'caption_limit', 'hook_length']);
const FORMAT_TEXTS = /** @type {const} */ (['file_formats', 'duration_note', 'file_size_note', 'hook_note', 'safe_zone']);

/** Every field of a format (§6.1). @param {{platform: any, format: any, onClose: () => void, onDone: () => void}} p */
function FormatDialog({ platform, format, onClose, onDone }) {
  const isNew = !format.id;
  const [f, setF] = useState(() => {
    /** @type {Record<string, any>} */ const o = { name: format.name ?? '', media_kind: format.media_kind ?? 'image' };
    for (const k of FORMAT_NUMBERS) o[k] = format[k] ?? (isNew ? { ratio_w: 1, ratio_h: 1, width: 1080, height: 1080, caption_limit: 2200 }[/** @type {string} */ (k)] ?? '' : '');
    for (const k of FORMAT_TEXTS) o[k] = format[k] ?? '';
    return o;
  });
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [busy, setBusy] = useState(false);
  /** @param {string} k @param {any} v */
  const set = (k, v) => setF({ ...f, [k]: v });

  /** @param {Event} e */
  async function submit(e) {
    e.preventDefault();
    const body = { ...f };
    for (const k of FORMAT_NUMBERS) body[k] = f[k] === '' || f[k] == null ? null : Number(f[k]);
    for (const k of FORMAT_TEXTS) body[k] = f[k].trim() || null;
    setBusy(true);
    setErrors({});
    try {
      if (isNew) await api('POST', `/platforms/${platform.id}/formats`, { body });
      else await api('PATCH', `/platforms/${platform.id}/formats/${format.id}`, { body, version: format.version });
      toast('success', t('common.saved'));
      onDone();
    } catch (/** @type {any} */ err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, t(`errors.${v}`)])));
      else toast('danger', errorText(err.code));
    } finally {
      setBusy(false);
    }
  }

  /** @param {typeof FORMAT_NUMBERS[number]} k @param {boolean} [required] */
  const num = (k, required) => html`<${Field} label=${t(`social.f_${k}`)} error=${errors[k]} required=${required}>
    ${(/** @type {any} */ a) => html`<${Input} ...${a} type="number" min="0" inputMode="numeric" value=${f[k]} onInput=${(/** @type {string} */ v) => set(k, v)} />`}
  </${Field}>`;
  /** @param {typeof FORMAT_TEXTS[number]} k */
  const txt = (k) => html`<${Field} label=${t(`social.f_${k}`)} error=${errors[k]}>
    ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f[k]} onInput=${(/** @type {string} */ v) => set(k, v)} />`}
  </${Field}>`;

  return html`<${Modal} open onClose=${onClose} size="lg" title=${isNew ? t('social.addFormatTo', { name: platform.name }) : t('common.editName', { name: format.name })}
    footer=${html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
      <${Button} variant="primary" type="submit" form="format-form" busy=${busy}>${t('common.save')}</${Button}>`}>
    <form id="format-form" class="stack" onSubmit=${submit} noValidate>
      <div class="field-row">
        <${Field} label=${t('social.formatName')} error=${errors.name} required>
          ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f.name} maxLength="80" onInput=${(/** @type {string} */ v) => set('name', v)} />`}
        </${Field}>
        <${Field} label=${t('social.std_kind')} error=${errors.media_kind} required>
          ${(/** @type {any} */ a) => html`<${Select} ...${a} value=${f.media_kind} onChange=${(/** @type {string} */ v) => set('media_kind', v)}
            options=${['image', 'video', 'carousel'].map((k) => ({ value: k, label: t(`social.kind_${k}`) }))} />`}
        </${Field}>
      </div>
      <div class="field-row" style=${{ '--field-min': '120px' }}>${num('ratio_w', true)}${num('ratio_h', true)}${num('width', true)}${num('height', true)}</div>
      ${txt('file_formats')}
      <div class="field-row" style=${{ '--field-min': '140px' }}>${num('min_duration_s')}${num('max_duration_s')}${num('max_file_mb')}${num('max_items')}</div>
      <div class="field-row">${txt('duration_note')}${txt('file_size_note')}</div>
      <div class="field-row" style=${{ '--field-min': '140px' }}>${num('caption_limit', true)}${num('hook_length')}</div>
      ${txt('hook_note')}
      ${txt('safe_zone')}
    </form>
  </${Modal}>`;
}

/**
 * Deleting a platform with posts: move them (with a format mapping) or
 * delete them; either way the name must be typed.
 * @param {{platform: any, all: any[], onClose: () => void, onDone: () => void}} p
 */
function DeletePlatformDialog({ platform, all, onClose, onDone }) {
  const others = all.filter((x) => x.id !== platform.id);
  const used = platform.formats.filter((/** @type {any} */ f) => f.post_count > 0);
  const [mode, setMode] = useState(others.length ? 'move' : 'delete');
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const tp = others.find((x) => x.id === target);
  const [map, setMap] = useState(/** @type {Record<string, string>} */ ({}));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Map each used format to the target format of the same kind, else the first.
    /** @type {Record<string, string>} */ const m = {};
    for (const f of used) m[f.id] = (tp?.formats.find((/** @type {any} */ x) => x.media_kind === f.media_kind) ?? tp?.formats[0])?.id ?? '';
    setMap(m);
  }, [target]);

  async function submit() {
    setBusy(true);
    try {
      await api('DELETE', `/platforms/${platform.id}`, {
        version: platform.version,
        body: mode === 'move' ? { mode, confirmName: name, targetPlatformId: target, formatMap: map } : { mode, confirmName: name },
      });
      toast('success', t('social.platformDeleted', { name: platform.name }));
      onDone();
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    } finally {
      setBusy(false);
    }
  }

  return html`<${Modal} open onClose=${onClose} title=${t('social.deletePlatformTitle', { name: platform.name })}
    footer=${html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
      <${Button} variant="danger" busy=${busy} disabled=${name.trim() !== platform.name} onClick=${submit}>
        ${mode === 'move' ? t('social.moveAndDelete') : t('social.deleteWithPosts')}</${Button}>`}>
    <div class="stack">
      <${Alert} tone="warning">${t('social.platformHasPosts', { n: platform.post_count })}</${Alert}>
      <${RadioGroup} legend=${t('social.whatWithPosts')} name="del-mode" value=${mode} onChange=${setMode}
        options=${[
          { value: 'move', label: t('social.movePosts'), disabled: !others.length },
          { value: 'delete', label: t('social.deletePosts', { n: platform.post_count }) },
        ]} />
      ${mode === 'move' && html`<div class="stack" style=${{ '--stack-gap': 'var(--space-3)' }}>
        <${Field} label=${t('social.targetPlatform')}>
          ${(/** @type {any} */ a) => html`<${Select} ...${a} value=${target} onChange=${setTarget} options=${others.map((x) => ({ value: x.id, label: x.name }))} />`}
        </${Field}>
        ${used.map((/** @type {any} */ f) => html`<${Field} label=${t('social.mapFormat', { name: f.name, n: f.post_count })}>
          ${(/** @type {any} */ a) => html`<${Select} ...${a} value=${map[f.id]} onChange=${(/** @type {string} */ v) => setMap({ ...map, [f.id]: v })}
            options=${(tp?.formats ?? []).map((/** @type {any} */ x) => ({ value: x.id, label: `${x.name} (${x.ratio})` }))} />`}
        </${Field}>`)}
      </div>`}
      <${Field} label=${t('social.typeNameToConfirm', { name: platform.name })}>
        ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${name} autocomplete="off" onInput=${setName} />`}
      </${Field}>
    </div>
  </${Modal}>`;
}

/** Import preview: what will be added, updated or removed. @param {{diff: any, onClose: () => void, onConfirm: () => Promise<void>}} p */
function ImportPreview({ diff, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const pl = diff.platforms;
  const nothing = !pl.added.length && !pl.updated.length && !pl.removed.length && !diff.formats.added && !diff.formats.updated && !diff.formats.removed
    && !diff.posts.added && !diff.posts.updated && !diff.posts.removed;
  return html`<${Modal} open onClose=${onClose} title=${t('social.importPreview')}
    footer=${html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
      <${Button} variant="primary" busy=${busy} disabled=${nothing} onClick=${async () => (setBusy(true), await onConfirm(), setBusy(false))}>${t('social.importConfirm')}</${Button}>`}>
    <div class="stack">
      ${nothing ? html`<${Alert} tone="info">${t('social.importNothing')}</${Alert}>` : html`<p>${t('social.importIntro')}</p>`}
      <ul class="diff-list">
        ${pl.added.length > 0 && html`<li><${Badge} tone="success">+${pl.added.length}</${Badge}>${t('social.diffPlatformsAdded', { names: pl.added.join(', ') })}</li>`}
        ${pl.updated.length > 0 && html`<li><${Badge} tone="info">~${pl.updated.length}</${Badge}>${t('social.diffPlatformsUpdated', { names: pl.updated.join(', ') })}</li>`}
        ${pl.removed.length > 0 && html`<li><${Badge} tone="danger">−${pl.removed.length}</${Badge}>${t('social.diffPlatformsRemoved', { names: pl.removed.join(', ') })}</li>`}
        ${pl.kept.length > 0 && html`<li><${Badge}>${pl.kept.length}</${Badge}>${t('social.diffPlatformsKept', { names: pl.kept.join(', ') })}</li>`}
        <li><${Icon} name="layers" />${t('social.diffFormats', diff.formats)}</li>
        <li><${Icon} name="megaphone" />${t('social.diffPosts', diff.posts)}</li>
      </ul>
      ${diff.warnings.length > 0 && html`<${Alert} tone="warning" title=${t('social.importWarnings')}>
        <ul class="plain-list">${diff.warnings.map((/** @type {any} */ w) => html`<li>${t(`social.warn_${w.code}`, w.params)}</li>`)}</ul>
      </${Alert}>`}
    </div>
  </${Modal}>`;
}
