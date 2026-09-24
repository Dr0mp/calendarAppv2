import { useLocation } from 'preact-iso';
import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { api, errorText } from '../../api.js';
import { usePageChrome } from '../../state/chrome.js';
import { postsRevision, invalidatePosts } from '../../state/social.js';
import { Button, EmptyState, Icon, SafeImg, SkeletonList, Tabs } from '../../components/ui.js';
import { PlatformIcon } from '../../components/platform-icon.js';
import { toast } from '../../components/toast.js';
import { fmtDateShort, fmtMoney } from '../../time.js';
import { PostOverlays } from './post-overlays.js';

const FILTERS = ['pending', 'promoted', 'skipped', 'all'];

/** "Coadă promovare": upcoming public events and their promotion posts. */
export default function Queue() {
  usePageChrome(t('social.queue'));
  const { query, path, route } = useLocation();
  const filter = FILTERS.includes(query.filter) ? query.filter : 'pending';
  const [data, setData] = useState(/** @type {{items: any[], counts: Record<string, number>}|null} */ (null));
  const [busy, setBusy] = useState(/** @type {string|null} */ (null));

  const load = () => api('GET', '/promotions', { query: { filter } }).then(setData);
  useEffect(() => {
    load();
  }, [filter, postsRevision.value]);

  /** @param {Record<string, string|null>} patch */
  const nav = (patch) => {
    const u = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) u.delete(k);
      else u.set(k, v);
    }
    const s = u.toString();
    route(`${path}${s ? `?${s}` : ''}`);
  };

  /** @param {any} e @param {boolean} skip */
  async function toggleSkip(e, skip) {
    setBusy(e.id);
    try {
      if (skip) await api('POST', `/promotions/${e.id}/skip`);
      else await api('DELETE', `/promotions/${e.id}/skip`);
      toast('success', skip ? t('social.skipped', { title: e.title }) : t('social.unskipped', { title: e.title }));
      invalidatePosts();
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    } finally {
      setBusy(null);
    }
  }

  const tabs = FILTERS.map((f) => ({ value: f, label: t(`social.queue_${f}`), count: data?.counts[f] ?? null }));

  return html`<div class="stack queue-page">
    <div class="page-head">
      <h1>${t('social.queue')}</h1>
      <a class="btn btn--secondary" href="/social"><${Icon} name="calendar" />${t('nav.social')}</a>
      <p class="page-sub">${t('social.queueIntro')}</p>
    </div>
    <${Tabs} label=${t('social.queueFilter')} items=${tabs} value=${filter} onChange=${(/** @type {string} */ v) => nav({ filter: v === 'pending' ? null : v })} />
    ${data === null
      ? html`<${SkeletonList} rows=${3} />`
      : data.items.length === 0
        ? html`<${EmptyState} icon="megaphone" title=${t(`social.queueEmpty_${filter}`)} text=${t('social.queueEmptyText')} />`
        : html`<ul class="queue-list" role="list">
            ${data.items.map((e) => html`<li key=${e.id}><${QueueCard} e=${e} busy=${busy === e.id}
              onCreate=${() => nav({ edit: 'new', event: e.id })} onSkip=${(/** @type {boolean} */ s) => toggleSkip(e, s)}
              onOpenPost=${(/** @type {string} */ id) => nav({ post: id })} /></li>`)}
          </ul>`}
    <${PostOverlays} />
  </div>`;
}

/** @param {{e: any, busy: boolean, onCreate: () => void, onSkip: (skip: boolean) => void, onOpenPost: (id: string) => void}} p */
function QueueCard({ e, busy, onCreate, onSkip, onOpenPost }) {
  const price = e.price_cents == null ? t('entry.free') : fmtMoney(e.price_cents, e.currency);
  return html`<article class="queue-card card" data-status=${e.promotion_status} aria-labelledby=${`q-${e.id}`}>
    <div class="queue-cover">
      ${e.cover ? html`<${SafeImg} src=${e.cover.thumb_url ?? e.cover.url} />` : html`<${Icon} name="image" />`}
    </div>
    <div class="queue-main">
      <h2 class="queue-title" id=${`q-${e.id}`}><a href=${`/entries/${e.id}`}>${e.title}</a></h2>
      <p class="queue-meta small">
        <span class="num"><${Icon} name="calendar" />${fmtDateShort(e.next.date)}, ${e.next.time}</span>
        ${e.space && html`<span><${Icon} name="map-pin" />${e.space.name}</span>`}
      </p>
      <p class="queue-meta small muted">
        <span><span class="owner-dot" style=${{ '--owner': `var(--${e.owner.color})` }} aria-hidden="true"></span>${e.owner.name}</span>
        <span><${Icon} name="tag" />${e.price_note ? `${price} · ${e.price_note}` : price}</span>
      </p>
      ${e.posts.length > 0 && html`<ul class="queue-posts" role="list" aria-label=${t('social.linkedPosts')}>
        ${e.posts.map((p) => html`<li><button type="button" class="post-link-chip" style=${{ '--platform': p.platform.color }} onClick=${() => onOpenPost(p.id)}
          title=${`${p.platform.name} · ${p.title}`}>
          <${PlatformIcon} platform=${p.platform} size=${14} /><span class="num">${fmtDateShort(p.publish_date)}</span>
          <span class="status-dot" data-status=${p.status} aria-hidden="true"></span><span class="sr-only">${p.platform.name}, ${t(`social.status_${p.status}`)}</span>
        </button></li>`)}
      </ul>`}
      ${e.promotion_status === 'skipped' && html`<p class="small muted"><${Icon} name="ban" /> ${t('social.isSkipped')}</p>`}
    </div>
    <div class="queue-actions">
      <${Button} variant="primary" size="sm" icon="plus" onClick=${onCreate}>${t('social.createPost')}</${Button}>
      ${e.promotion_status === 'skipped'
        ? html`<${Button} size="sm" icon="undo-2" busy=${busy} onClick=${() => onSkip(false)}>${t('social.unskip')}</${Button}>`
        : e.promotion_status === 'pending' && html`<${Button} size="sm" variant="ghost" icon="ban" busy=${busy} onClick=${() => onSkip(true)}>${t('social.skip')}</${Button}>`}
    </div>
  </article>`;
}
