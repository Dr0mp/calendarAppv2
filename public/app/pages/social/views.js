import { html, useMemo, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { Icon, IconButton, SafeImg } from '../../components/ui.js';
import { Modal, Popover } from '../../components/overlay.js';
import { isCompact } from '../../components/media-query.js';
import { PlatformIcon } from '../../components/platform-icon.js';
import { copyText } from '../../components/clipboard.js';
import { fmtDateLong, fmtMonth, monthGrid, today, weekdayNames, isPastSlot } from '../../time.js';
import { UNC_RE } from '/shared/rules/validate.js';

export const KIND_ICON = { video: 'video', image: 'image', carousel: 'images' };
export const SOCIAL_VIEWS = /** @type {const} */ (['year', 'month', 'list']);

/** @param {any[]} posts */
export function postsByDate(posts) {
  /** @type {Map<string, any[]>} */ const m = new Map();
  for (const p of posts) {
    const list = m.get(p.publish_date) ?? [];
    list.push(p);
    m.set(p.publish_date, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.publish_time.localeCompare(b.publish_time));
  return m;
}

/** @param {{status: string}} p */
export function StatusDot({ status }) {
  return html`<span class="status-dot" data-status=${status} role="img" aria-label=${t(`social.status_${status}`)} title=${t(`social.status_${status}`)}></span>`;
}

/** @param {{status: string}} p */
export function StatusBadge({ status }) {
  return html`<span class="status-badge" data-status=${status}><span class="status-dot" data-status=${status} aria-hidden="true"></span>${t(`social.status_${status}`)}</span>`;
}

/** A post in the month grid: favicon, time, title, media kind and status. @param {{post: any, onOpen: (id: string) => void}} p */
export function PostChip({ post, onOpen }) {
  return html`<button type="button" class="post-chip" data-status=${post.status} style=${{ '--platform': post.platform.color }}
    onClick=${(/** @type {Event} */ e) => (e.stopPropagation(), onOpen(post.id))} title=${`${post.publish_time} · ${post.platform.name} · ${post.title}`}>
    <${PlatformIcon} platform=${post.platform} size=${14} />
    <span class="chip-time num">${post.publish_time}</span>
    <span class="chip-title">${post.title}</span>
    <${Icon} name=${KIND_ICON[/** @type {'video'} */ (post.format.media_kind)]} class="chip-kind" />
    <${StatusDot} status=${post.status} />
  </button>`;
}

/** One row in a day list (phone sheet). @param {{post: any, onOpen: (id: string) => void}} p */
export function PostRow({ post, onOpen }) {
  return html`<button type="button" class="agenda-row post-row" style=${{ '--owner': post.platform.color }} onClick=${() => onOpen(post.id)}>
    <span class="agenda-time num">${post.publish_time}</span>
    <span class="agenda-main">
      <span class="agenda-title"><${PlatformIcon} platform=${post.platform} size=${16} />${post.title}</span>
      <span class="agenda-meta small muted">${post.platform.name} · ${post.format.name}</span>
    </span>
    <${StatusDot} status=${post.status} />
  </button>`;
}

/**
 * @typedef {{posts: any[], anchor: string, openPost: (id: string) => void, newPost: (d: string) => void,
 *   goMonth: (d: string) => void, loading: boolean}} ViewProps
 */

/** Twelve mini-months with a dot per platform colour (up to 3). @param {ViewProps} p */
export function SocialYear({ posts, anchor, goMonth, loading }) {
  const year = anchor.slice(0, 4);
  const byDate = useMemo(() => postsByDate(posts), [posts]);
  const t0 = today();
  const wd = weekdayNames('narrow');
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  return html`<div class="year-grid">
    ${months.map((ym) => {
      const grid = monthGrid(ym);
      const n = posts.filter((p) => p.publish_date.startsWith(ym)).length;
      return html`<section class="mini-month card" aria-labelledby=${`smm-${ym}`}>
        <header class="mini-head">
          <button type="button" class="mini-title" id=${`smm-${ym}`} onClick=${() => goMonth(`${ym}-01`)}>${fmtMonth(ym)}</button>
          ${!loading && html`<span class=${`count ${n ? 'count--accent' : ''}`} title=${t('social.postsInMonth', { n })}>${n}</span>`}
        </header>
        <div class="mini-grid" role="grid" aria-labelledby=${`smm-${ym}`}>
          <div role="row" class="mini-row">${wd.map((d) => html`<span role="columnheader" class="mini-wd">${d}</span>`)}</div>
          ${Array.from({ length: 6 }, (_, r) => grid.slice(r * 7, r * 7 + 7))
            .filter((week) => week.some((d) => d.slice(0, 7) === ym))
            .map((week) => html`<div role="row" class="mini-row">
              ${week.map((d) => {
                if (d.slice(0, 7) !== ym) return html`<span role="gridcell" class="mini-day is-out"></span>`;
                const items = byDate.get(d) ?? [];
                const colors = [...new Set(items.map((p) => p.platform.color))].slice(0, 3);
                return html`<button type="button" role="gridcell" class="mini-day" data-date=${d}
                  data-today=${d === t0 ? 'true' : undefined} data-past=${d < t0 ? 'true' : undefined}
                  title=${items.map((p) => `${p.publish_time} ${p.platform.name}: ${p.title}`).join('\n') || undefined}
                  aria-label=${`${fmtDateLong(d)}${items.length ? `, ${t('social.nPosts', { n: items.length })}` : ''}`}
                  onClick=${() => goMonth(d)}>
                  <span class="num">${Number(d.slice(8))}</span>
                  ${colors.length > 0 && html`<span class="mini-dots" aria-hidden="true">${colors.map((c) => html`<i style=${{ background: c }}></i>`)}</span>`}
                </button>`;
              })}
            </div>`)}
        </div>
      </section>`;
    })}
  </div>`;
}

/** Month grid: chips on desktop, platform-colour bars and a day sheet on phones. @param {ViewProps} p */
export function SocialMonth({ posts, anchor, openPost, newPost, loading }) {
  const ym = anchor.slice(0, 7);
  const grid = monthGrid(ym);
  const byDate = useMemo(() => postsByDate(posts), [posts]);
  const t0 = today();
  const compact = isCompact.value;
  const wd = weekdayNames(compact ? 'narrow' : 'short');
  const [sheet, setSheet] = useState(/** @type {string|null} */ (null));

  return html`<div class=${`month social-month ${compact ? 'month--compact' : ''}`} role="grid" aria-label=${fmtMonth(ym)}>
    <div role="row" class="month-head">${wd.map((d, i) => html`<div role="columnheader" class="month-wd" data-weekend=${i >= 5 ? 'true' : undefined}>${d}</div>`)}</div>
    ${Array.from({ length: 6 }, (_, r) => html`<div role="row" class="month-row">
      ${grid.slice(r * 7, r * 7 + 7).map((d, c) => {
        const items = byDate.get(d) ?? [];
        const future = !isPastSlot(d, '23:00');
        const visible = items.slice(0, 4);
        const more = items.length - visible.length;
        const label = `${fmtDateLong(d)}${items.length ? `, ${t('social.nPosts', { n: items.length })}` : ''}`;
        return html`<div role="gridcell" class="mday" data-date=${d} id=${`sday-${d}`}
          data-out=${d.slice(0, 7) !== ym ? 'true' : undefined} data-weekend=${c >= 5 ? 'true' : undefined}
          data-past=${d < t0 ? 'true' : undefined} data-today=${d === t0 ? 'true' : undefined} aria-label=${label}
          onClick=${compact ? () => setSheet(d) : undefined}>
          <div class="mday-top">
            ${compact
              ? html`<button type="button" class="mday-num num" aria-label=${label} onClick=${(/** @type {Event} */ e) => (e.stopPropagation(), setSheet(d))}>${Number(d.slice(8))}</button>`
              : html`<span class="mday-num num">${Number(d.slice(8))}</span>`}
            ${!compact && future && html`<button type="button" class="mday-add" aria-label=${t('social.newPostOn', { date: fmtDateLong(d) })}
              onClick=${() => newPost(d)}><${Icon} name="plus" /></button>`}
          </div>
          ${loading
            ? null
            : compact
              ? html`<div class="mday-bars" aria-hidden="true">${items.slice(0, 3).map((p) => html`<i style=${{ '--owner': p.platform.color }}></i>`)}</div>`
              : html`<div class="mday-items">
                  ${visible.map((p) => html`<${PostChip} post=${p} onOpen=${openPost} />`)}
                  ${more > 0 && html`<${Popover} label=${fmtDateLong(d)} trigger=${(/** @type {any} */ pp) => html`<button type="button" class="mday-more" ref=${pp.ref}
                    onClick=${(/** @type {Event} */ e) => (e.stopPropagation(), pp.toggle())} aria-expanded=${pp['aria-expanded']}>${t('calendar.nMore', { n: more })}</button>`}>
                    ${() => html`<div class="day-pop stack" style=${{ '--stack-gap': 'var(--space-1)' }}>
                      <strong class="small">${fmtDateLong(d)}</strong>
                      ${items.map((p) => html`<${PostChip} post=${p} onOpen=${openPost} />`)}
                    </div>`}
                  </${Popover}>`}
                </div>`}
        </div>`;
      })}
    </div>`)}
    ${compact && html`<${Modal} open=${!!sheet} onClose=${() => setSheet(null)} kind="sheet" title=${sheet ? fmtDateLong(sheet) : ''}
      footer=${sheet && !isPastSlot(sheet, '23:00') && html`<button type="button" class="btn btn--primary btn--block"
        onClick=${() => { const d = /** @type {string} */ (sheet); setSheet(null); newPost(d); }}><${Icon} name="plus" />${t('social.newPostThisDay')}</button>`}>
      ${sheet && ((byDate.get(sheet) ?? []).length === 0
        ? html`<p class="muted">${t('social.dayEmpty')}</p>`
        : html`<ul class="day-list" role="list">${(byDate.get(sheet) ?? []).map(
            (p) => html`<li><${PostRow} post=${p} onOpen=${(/** @type {string} */ id) => (setSheet(null), openPost(id))} /></li>`,
          )}</ul>`)}
    </${Modal}>`}
  </div>`;
}

/** First media item's preview: thumbnail (videos: poster with a play icon). @param {{post: any}} p */
export function PostThumb({ post }) {
  const m = post.media[0];
  if (!m) return html`<div class="post-thumb post-thumb--empty"><${Icon} name=${KIND_ICON[/** @type {'video'} */ (post.format.media_kind)]} /></div>`;
  const video = m.media ? m.media.kind === 'video' : m.kind === 'video';
  const src = m.media ? m.media.thumb_url ?? (video ? null : m.media.url) : video ? null : m.url;
  return html`<div class="post-thumb">
    ${src ? html`<${SafeImg} src=${src} />` : html`<${Icon} name="video" />`}
    ${video && html`<span class="media-tile-play"><${Icon} name="play" /></span>`}
    ${post.media.length > 1 && html`<span class="post-thumb-count num">${post.media.length}</span>`}
  </div>`;
}

/** Open or copy a share link (UNC paths are copied with instructions). @param {string} link */
export function testShareLink(link) {
  if (UNC_RE.test(link)) {
    copyText(link, t('social.uncCopied'));
    return;
  }
  window.open(link, '_blank', 'noopener,noreferrer');
}

/** @param {{link: string}} p */
export function ShareButtons({ link }) {
  return html`<span class="cluster share-buttons" style=${{ '--cluster-gap': 'var(--space-1)' }}>
    <button type="button" class="btn btn--ghost btn--sm" onClick=${(/** @type {Event} */ e) => (e.stopPropagation(), copyText(link))}>
      <${Icon} name="copy" />${t('social.copy')}</button>
    ${!UNC_RE.test(link) && html`<a class="btn btn--ghost btn--sm" href=${link} target="_blank" rel="noopener noreferrer" onClick=${(/** @type {Event} */ e) => e.stopPropagation()}>
      <${Icon} name="external-link" />${t('social.open')}</a>`}
  </span>`;
}

/** The list (feed) view: posts grouped by date. @param {ViewProps} p */
export function SocialList({ posts, openPost }) {
  const byDate = useMemo(() => postsByDate(posts), [posts]);
  const dates = [...byDate.keys()].sort();
  const t0 = today();
  if (!dates.length) return null;
  return html`<div class="post-feed stack">
    ${dates.map((d) => html`<section class="stack" style=${{ '--stack-gap': 'var(--space-2)' }} aria-labelledby=${`pf-${d}`}>
      <h2 class="section-title" id=${`pf-${d}`} data-today=${d === t0 ? 'true' : undefined}>${fmtDateLong(d)}</h2>
      <div class="post-cards">
        ${(byDate.get(d) ?? []).map((p) => html`<${PostCard} post=${p} onOpen=${openPost} />`)}
      </div>
    </section>`)}
  </div>`;
}

/** @param {{post: any, onOpen: (id: string) => void}} p */
export function PostCard({ post, onOpen }) {
  return html`<article class="post-card card" style=${{ '--platform': post.platform.color }}>
    <${PostThumb} post=${post} />
    <div class="post-card-main">
      <div class="cluster small muted" style=${{ '--cluster-gap': 'var(--space-2)' }}>
        <span class="cluster" style=${{ '--cluster-gap': '6px' }}><${PlatformIcon} platform=${post.platform} size=${16} /><strong class="text-strong">${post.platform.name}</strong></span>
        <span>${post.format.name}</span>
        <span class="num">${post.publish_time}</span>
      </div>
      <h3 class="post-card-title"><a href=${`?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), post: post.id })}`}
        onClick=${(/** @type {Event} */ e) => (e.preventDefault(), onOpen(post.id))}>${post.title}</a></h3>
      ${post.caption && html`<p class="post-card-caption small">${post.caption}</p>`}
      <div class="cluster" style=${{ '--cluster-gap': 'var(--space-2)' }}>
        <${StatusBadge} status=${post.status} />
        ${post.event && html`<span class="small muted"><${Icon} name="megaphone" /> ${post.event.title}</span>`}
        ${post.share_link && html`<${ShareButtons} link=${post.share_link} />`}
      </div>
    </div>
    <${IconButton} icon="chevron-right" label=${t('social.openPost', { title: post.title })} class="post-card-go" onClick=${() => onOpen(post.id)} />
  </article>`;
}
