import { html, useEffect, useRef, useState } from '../html.js';
import { t } from '../i18n/index.js';
import { api, errorText, upload } from '../api.js';
import { Modal } from './overlay.js';
import { Button, EmptyState, Icon, Progress, SearchField, SkeletonList, Tabs } from './ui.js';
import { toast } from './toast.js';
import { fmtBytes } from '../time.js';

const ACCEPT = {
  image: 'image/jpeg,image/png,image/webp,image/gif,image/avif',
  video: 'video/mp4,video/quicktime,video/webm',
};

/**
 * @typedef {{key: string, name: string, size: number, progress: number, status: 'uploading'|'done'|'error', error?: string, media?: any}} UploadItem
 */

/**
 * Upload several files one by one, reporting progress per file.
 * @param {File[]} files @param {(items: UploadItem[]) => void} onUpdate
 * @returns {Promise<any[]>} the media records that uploaded
 */
export async function uploadFiles(files, onUpdate) {
  /** @type {UploadItem[]} */
  const items = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, size: f.size, progress: 0, status: 'uploading' }));
  const push = () => onUpdate(items.map((x) => ({ ...x })));
  push();
  const done = [];
  for (let i = 0; i < files.length; i++) {
    try {
      const m = await upload(files[i], {
        onProgress: (p) => {
          items[i].progress = p;
          push();
        },
      });
      items[i] = { ...items[i], progress: 1, status: 'done', media: m };
      done.push(m);
    } catch (/** @type {any} */ err) {
      items[i] = { ...items[i], status: 'error', error: errorText(err.code) };
    }
    push();
  }
  return done;
}

/**
 * Drop zone with a file picker. Also accepts dropped files.
 * @param {{kind?: 'image'|'video'|null, multiple?: boolean, onFiles: (f: File[]) => void, compact?: boolean, id?: string}} p
 */
export function DropZone({ kind = null, multiple = false, onFiles, compact, id }) {
  const [over, setOver] = useState(false);
  const accept = kind ? ACCEPT[kind] : `${ACCEPT.image},${ACCEPT.video}`;
  /** @param {DragEvent} e */
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  return html`<label class=${`dropzone ${compact ? 'dropzone--compact' : ''}`} data-over=${over ? 'true' : undefined}
      onDragOver=${(/** @type {DragEvent} */ e) => (e.preventDefault(), setOver(true))} onDragLeave=${() => setOver(false)} onDrop=${onDrop}>
    <input id=${id} type="file" class="sr-only" accept=${accept} multiple=${multiple}
      onChange=${(/** @type {any} */ e) => {
        const files = [...e.currentTarget.files];
        e.currentTarget.value = '';
        if (files.length) onFiles(files);
      }} />
    <${Icon} name="upload" />
    <span><strong class="link-like">${t('media.chooseFile')}</strong> <span class="hide-compact">${t('media.orDrop')}</span></span>
    <span class="small muted">${t(kind === 'video' ? 'media.limitsVideo' : kind === 'image' ? 'media.limitsImage' : 'media.limitsAny')}</span>
  </label>`;
}

/** @param {{items: UploadItem[]}} p */
export function UploadList({ items }) {
  if (!items.length) return null;
  return html`<ul class="upload-list" aria-live="polite">
    ${items.map(
      (u) => html`<li key=${u.key} data-status=${u.status}>
        <div class="upload-row">
          <${Icon} name=${u.status === 'error' ? 'circle-alert' : u.status === 'done' ? 'circle-check' : 'upload'} />
          <span class="upload-name">${u.name}</span>
          <span class="small muted num">${fmtBytes(u.size)}</span>
        </div>
        ${u.status === 'uploading' && html`<${Progress} value=${u.progress} label=${t('media.uploading', { name: u.name })} />`}
        ${u.status === 'error' && html`<p class="small text-danger">${u.error}</p>`}
      </li>`,
    )}
  </ul>`;
}

/**
 * Media library + upload dialog. Returns picked media records.
 * @param {{open: boolean, onClose: () => void, onPick: (items: any[]) => void, kind?: 'image'|'video'|null,
 *   multiple?: boolean, title?: string, initialTab?: 'upload'|'library'}} p
 */
export function MediaPicker({ open, onClose, onPick, kind = null, multiple = false, title, initialTab = 'upload' }) {
  const [tab, setTab] = useState(initialTab);
  const [uploads, setUploads] = useState(/** @type {UploadItem[]} */ ([]));
  const [lib, setLib] = useState(/** @type {any[]|null} */ (null));
  const [mine, setMine] = useState(true);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(/** @type {string[]} */ ([]));
  const busy = uploads.some((u) => u.status === 'uploading');

  useEffect(() => {
    if (open) setTab(initialTab);
    else {
      setUploads([]);
      setSel([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'library') return;
    setLib(null);
    const h = setTimeout(() => {
      api('GET', '/media', { query: { kind: kind ?? undefined, mine: mine ? '1' : undefined, q: q.trim() || undefined } })
        .then((r) => setLib(r.items))
        .catch(() => setLib([]));
    }, q ? 250 : 0);
    return () => clearTimeout(h);
  }, [open, tab, mine, q, kind]);

  /** @param {File[]} files */
  const onFiles = async (files) => {
    const done = await uploadFiles(files, setUploads);
    if (!done.length) return;
    if (!multiple) {
      onPick(done.slice(0, 1));
      onClose();
    } else if (done.length === files.length) {
      onPick(done);
      onClose();
    }
  };

  /** @param {any} m */
  const toggle = (m) => {
    if (!multiple) {
      onPick([m]);
      onClose();
      return;
    }
    setSel((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]));
  };

  const pickedOk = uploads.filter((u) => u.status === 'done').map((u) => u.media);
  const footer =
    multiple && tab === 'library'
      ? html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
          <${Button} variant="primary" disabled=${!sel.length} onClick=${() => (onPick(sel.map((id) => lib?.find((m) => m.id === id)).filter(Boolean)), onClose())}>
            ${t('media.useN', { n: sel.length })}</${Button}>`
      : multiple && pickedOk.length && !busy
        ? html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
            <${Button} variant="primary" onClick=${() => (onPick(pickedOk), onClose())}>${t('media.useN', { n: pickedOk.length })}</${Button}>`
        : html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>`;

  return html`<${Modal} open=${open} onClose=${onClose} title=${title ?? t('media.pickTitle')} size="lg" class="media-picker" footer=${footer}>
    <div class="stack">
      <${Tabs} label=${t('media.source')} value=${tab} onChange=${setTab}
        items=${[
          { value: 'upload', label: t('media.upload') },
          { value: 'library', label: t('media.library') },
        ]} />
      ${tab === 'upload'
        ? html`<div class="stack">
            <${DropZone} kind=${kind} multiple=${multiple} onFiles=${onFiles} id="media-file" />
            <${UploadList} items=${uploads} />
          </div>`
        : html`<div class="stack">
            <div class="cluster">
              <${SearchField} value=${q} onInput=${setQ} placeholder=${t('media.search')} class="grow" />
              <label class="check"><input type="checkbox" checked=${mine} onChange=${(/** @type {any} */ e) => setMine(e.currentTarget.checked)} />
                <span>${t('media.mineOnly')}</span></label>
            </div>
            ${lib === null
              ? html`<${SkeletonList} rows=${2} />`
              : lib.length === 0
                ? html`<${EmptyState} icon="images" title=${t('media.emptyTitle')} text=${t('media.emptyText')} />`
                : html`<ul class="media-grid" role="list">
                    ${lib.map(
                      (m) => html`<li key=${m.id}>
                        <button type="button" class="media-tile" aria-pressed=${multiple ? (sel.includes(m.id) ? 'true' : 'false') : undefined}
                          onClick=${() => toggle(m)} title=${m.original_name ?? ''}>
                          ${m.thumb_url ? html`<img src=${m.thumb_url} alt="" loading="lazy" />` : html`<${Icon} name=${m.kind === 'video' ? 'video' : 'image'} />`}
                          ${m.kind === 'video' && html`<span class="media-tile-play"><${Icon} name="play" /></span>`}
                          <span class="media-tile-meta">${m.original_name ?? ''}<span class="num">${m.width && m.height ? ` · ${m.width}×${m.height}` : ''}</span></span>
                          ${multiple && sel.includes(m.id) && html`<span class="media-tile-check"><${Icon} name="check" /></span>`}
                        </button>
                      </li>`,
                    )}
                  </ul>`}
          </div>`}
    </div>
  </${Modal}>`;
}

/**
 * The largest centred frame of the given ratio inside w × h.
 * @param {number} w @param {number} h @param {number} [ratio]
 */
export function fitFrame(w, h, ratio = 16 / 9) {
  let fw = w;
  let fh = Math.round(w / ratio);
  if (fh > h) {
    fh = h;
    fw = Math.round(h * ratio);
  }
  return { x: Math.round((w - fw) / 2), y: Math.round((h - fh) / 2), w: fw, h: fh };
}

/**
 * "Decupează la 16:9": a draggable 16:9 frame over the image; the server
 * crops and stores a new media record.
 * @param {{open: boolean, media: any, onClose: () => void, onDone: (m: any) => void, ratio?: number, title?: string}} p
 */
export function CropDialog({ open, media, onClose, onDone, ratio = 16 / 9, title }) {
  const W = media?.width ?? 0;
  const H = media?.height ?? 0;
  const [scale, setScale] = useState(100);
  const [frame, setFrame] = useState(() => fitFrame(W, H, ratio));
  const [busy, setBusy] = useState(false);
  const box = useRef(/** @type {HTMLDivElement|null} */ (null));
  const drag = useRef(/** @type {{px: number, py: number, fx: number, fy: number}|null} */ (null));

  useEffect(() => {
    if (open) {
      setScale(100);
      setFrame(fitFrame(W, H, ratio));
    }
  }, [open, media?.id]);

  /** @param {number} x @param {number} y @param {number} [s] */
  const place = (x, y, s = scale) => {
    const max = fitFrame(W, H, ratio);
    const w = Math.max(16, Math.round((max.w * s) / 100));
    const h = Math.min(H, Math.round(w / ratio));
    setFrame({ w, h, x: Math.round(Math.min(Math.max(0, x), W - w)), y: Math.round(Math.min(Math.max(0, y), H - h)) });
  };

  /** @param {number} s */
  const resize = (s) => {
    setScale(s);
    const cx = frame.x + frame.w / 2;
    const cy = frame.y + frame.h / 2;
    const max = fitFrame(W, H, ratio);
    const w = (max.w * s) / 100;
    place(cx - w / 2, cy - w / ratio / 2, s);
  };

  /** Pixels on screen → pixels in the image. */
  const factor = () => (box.current ? W / box.current.getBoundingClientRect().width : 1);

  /** @param {PointerEvent} e */
  const onDown = (e) => {
    e.preventDefault();
    /** @type {HTMLElement} */ (e.currentTarget).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, fx: frame.x, fy: frame.y };
  };
  /** @param {PointerEvent} e */
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const f = factor();
    place(d.fx + (e.clientX - d.px) * f, d.fy + (e.clientY - d.py) * f);
  };
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    const step = Math.max(1, Math.round((e.shiftKey ? 50 : 10) * factor()));
    const moves = /** @type {Record<string, [number, number]>} */ ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] });
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    place(frame.x + m[0], frame.y + m[1]);
  };

  const save = async () => {
    setBusy(true);
    try {
      const m = await api('POST', `/media/${media.id}/crop`, { body: frame });
      onDone(m);
      onClose();
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    } finally {
      setBusy(false);
    }
  };

  const pct = (/** @type {number} */ v, /** @type {number} */ of) => `${(v / of) * 100}%`;
  return html`<${Modal} open=${open} onClose=${onClose} title=${title ?? t('media.cropTitle')} size="lg"
    footer=${html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
      <${Button} variant="primary" icon="crop" busy=${busy} onClick=${save}>${t('media.cropSave')}</${Button}>`}>
    ${media && html`<div class="stack">
      <p class="small muted">${t('media.cropHelp')}</p>
      <div class="crop-stage" ref=${box} style=${{ aspectRatio: `${W} / ${H}` }}>
        <img src=${media.url} alt="" draggable="false" />
        <div class="crop-frame" role="slider" tabindex="0" aria-label=${t('media.cropFrame')}
          aria-valuetext=${`${frame.w} × ${frame.h}, x ${frame.x}, y ${frame.y}`}
          style=${{ left: pct(frame.x, W), top: pct(frame.y, H), width: pct(frame.w, W), height: pct(frame.h, H) }}
          onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${() => (drag.current = null)} onPointerCancel=${() => (drag.current = null)}
          onKeyDown=${onKey}></div>
      </div>
      <label class="field">
        <span class="field-label">${t('media.cropSize')} <span class="muted num">${frame.w} × ${frame.h}</span></span>
        <input type="range" min="30" max="100" step="1" value=${scale} onInput=${(/** @type {any} */ e) => resize(Number(e.currentTarget.value))} />
      </label>
    </div>`}
  </${Modal}>`;
}
