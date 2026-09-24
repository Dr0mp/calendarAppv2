import { useLocation } from 'preact-iso';
import { html, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { Overlay } from '../../components/overlay.js';
import { PostDetail } from './post-detail.js';
import { PostEditor } from './post-editor.js';

/**
 * The post detail (`?post=<id>`) and editor (`?edit=<id>|new`, with `on`,
 * `dup`) as a side panel on desktop and a full-screen sheet on phones.
 */
export function PostOverlays() {
  const { query, path, route } = useLocation();
  const [title, setTitle] = useState('');
  const [editTitle, setEditTitle] = useState('');

  /** @param {Record<string, string|null>} patch */
  const nav = (patch) => {
    const u = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) u.delete(k);
      else u.set(k, v);
    }
    const s = u.toString();
    route(`${path}${s ? `?${s}` : ''}`, true);
  };
  const editing = query.edit ?? null;
  const closeEditor = () => nav({ edit: null, on: null, dup: null, event: null });

  return html`
    <${Overlay} open=${!!query.post && !editing} onClose=${() => nav({ post: null })} title=${title || t('social.post')} phone="full">
      ${query.post && !editing && html`<${PostDetail} id=${query.post} onLoaded=${(/** @type {any} */ p) => setTitle(p.title)}
        onClose=${() => nav({ post: null })} onEdit=${() => nav({ edit: query.post, post: null })}
        onDuplicate=${() => nav({ edit: 'new', dup: query.post, post: null })} />`}
    </${Overlay}>
    <${Overlay} open=${!!editing} onClose=${closeEditor} title=${editTitle} phone="full" size="lg">
      ${editing && html`<${PostEditor} key=${`${editing}-${query.dup ?? ''}-${query.event ?? ''}`} id=${editing === 'new' ? null : editing} on=${query.on ?? null}
        dup=${query.dup ?? null} eventId=${editing === 'new' ? query.event ?? null : null} platformHint=${query.platform} onTitle=${setEditTitle}
        onDone=${(/** @type {any} */ saved, /** @type {any} */ next) => {
          if (next?.dup) nav({ edit: 'new', dup: next.dup, on: null, post: null, event: null });
          else if (saved) nav({ edit: null, on: null, dup: null, event: null, post: saved.id });
          else closeEditor();
        }} />`}
    </${Overlay}>`;
}
