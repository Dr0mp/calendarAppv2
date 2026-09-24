import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { api, errorText } from '../../api.js';
import { invalidatePosts, postsRevision } from '../../state/social.js';
import { Badge, Button, Icon, IconButton, SkeletonList } from '../../components/ui.js';
import { confirm } from '../../components/overlay.js';
import { toast } from '../../components/toast.js';
import { PlatformIcon } from '../../components/platform-icon.js';
import { fmtDateLong, fmtInstant } from '../../time.js';
import { KIND_ICON, ShareButtons, StatusBadge } from './views.js';

/**
 * A post: media (swipeable carousel), badges, date, status, share link and caption.
 * @param {{id: string, onEdit: () => void, onDuplicate: () => void, onClose: () => void, onLoaded: (p: any) => void}} p
 */
export function PostDetail({ id, onEdit, onDuplicate, onClose, onLoaded }) {
  const [post, setPost] = useState(/** @type {any} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  useEffect(() => {
    let live = true;
    setError(null);
    api('GET', `/posts/${id}`)
      .then((p) => {
        if (!live) return;
        setPost(p);
        onLoaded(p);
      })
      .catch((err) => live && setError(err.code));
    return () => {
      live = false;
    };
  }, [id, postsRevision.value]);

  if (error) return html`<p class="text-danger">${errorText(error)}</p>`;
  if (!post) return html`<${SkeletonList} rows=${4} />`;

  const remove = async () => {
    const ok = await confirm({ title: t('social.deleteTitle'), message: t('social.deleteText', { title: post.title }), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return;
    try {
      await api('DELETE', `/posts/${post.id}`, { version: post.version });
      invalidatePosts();
      toast('success', t('social.deleted'));
      onClose();
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    }
  };

  return html`<article class="post-detail stack">
    ${post.media.length > 0 && html`<${MediaCarousel} items=${post.media} />`}
    <div class="cluster" style=${{ '--cluster-gap': 'var(--space-2)' }}>
      <span class="badge platform-badge" style=${{ '--platform': post.platform.color }}>
        <${PlatformIcon} platform=${post.platform} size=${14} />${post.platform.name}${!post.platform.enabled ? ` ${t('social.disabledSuffix')}` : ''}
      </span>
      <${Badge} icon=${KIND_ICON[/** @type {'video'} */ (post.format.media_kind)]}>${post.format.name}</${Badge}>
      <${StatusBadge} status=${post.status} />
    </div>
    <p class="post-when"><${Icon} name="calendar" /> ${fmtDateLong(post.publish_date)}, <span class="num">${post.publish_time}</span></p>
    ${post.event && html`<p class="small"><${Icon} name="megaphone" /> ${t('social.promotesEvent', { title: '' })}
      <a href=${`/entries/${post.event.id}`}>${post.event.title}</a></p>`}
    <dl class="detail-meta">
      <div><dt>${t('social.media')}</dt><dd>${mediaSummary(post)}</dd></div>
      ${post.share_link && html`<div><dt>${t('social.shareLink')}</dt><dd class="share-box">
        <code class="share-link">${post.share_link}</code><${ShareButtons} link=${post.share_link} />
      </dd></div>`}
    </dl>
    ${post.caption
      ? html`<section class="stack" style=${{ '--stack-gap': 'var(--space-2)' }}>
          <h3 class="section-title">${t('social.caption')}</h3>
          <p class="post-caption">${post.caption}</p>
        </section>`
      : html`<p class="muted small">${t('social.noCaption')}</p>`}
    <p class="xs muted">${t('social.updatedAt', { when: fmtInstant(post.updated_at) })}</p>
    <div class="form-actions">
      <${Button} variant="danger-ghost" icon="trash-2" onClick=${remove} class="me-auto">${t('common.delete')}</${Button}>
      <${Button} icon="copy" onClick=${onDuplicate}>${t('social.duplicateDraft')}</${Button}>
      <${Button} variant="primary" icon="pencil" onClick=${onEdit}>${t('common.edit')}</${Button}>
    </div>
  </article>`;
}

/** @param {any} post */
function mediaSummary(post) {
  if (!post.media.length) return t('social.noMedia');
  const v = post.media.filter((/** @type {any} */ m) => (m.media ? m.media.kind === 'video' : m.kind === 'video')).length;
  return t('social.mediaSummary', { images: post.media.length - v, videos: v });
}

/** Horizontal scroll-snap carousel (swipe on touch, arrows on desktop). @param {{items: any[]}} p */
function MediaCarousel({ items }) {
  const [i, setI] = useState(0);
  /** @param {any} e */
  const onScroll = (e) => {
    const el = e.currentTarget;
    setI(Math.round(el.scrollLeft / el.clientWidth));
  };
  /** @param {number} n */
  const go = (n) => {
    const el = /** @type {HTMLElement|null} */ (document.querySelector('.carousel-track'));
    el?.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' });
  };
  return html`<div class="carousel" role="group" aria-roledescription="carousel" aria-label=${t('social.media')}>
    <div class="carousel-track" onScroll=${onScroll} tabindex="0">
      ${items.map((m, n) => {
        const media = m.media;
        const video = media ? media.kind === 'video' : m.kind === 'video';
        const src = media ? media.url : m.url;
        return html`<div class="carousel-slide" role="group" aria-roledescription="slide" aria-label=${`${n + 1} / ${items.length}`}>
          ${video
            ? html`<video src=${src} poster=${media?.thumb_url ?? undefined} controls preload="metadata" playsinline></video>`
            : html`<img src=${src} alt="" referrerpolicy="no-referrer" />`}
        </div>`;
      })}
    </div>
    ${items.length > 1 && html`<div class="carousel-nav">
      <${IconButton} icon="chevron-left" label=${t('calendar.previous')} disabled=${i === 0} onClick=${() => go(i - 1)} />
      <span class="small num" aria-live="polite">${i + 1} / ${items.length}</span>
      <${IconButton} icon="chevron-right" label=${t('calendar.next')} disabled=${i === items.length - 1} onClick=${() => go(i + 1)} />
    </div>`}
  </div>`;
}
