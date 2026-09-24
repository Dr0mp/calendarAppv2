import { useLocation } from 'preact-iso';
import { html, useEffect, useMemo, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { store } from '../../state/prefs.js';
import { usePageChrome } from '../../state/chrome.js';
import { loadPlatforms, platforms, postsRevision } from '../../state/social.js';
import { counts } from '../../state/counts.js';
import { api } from '../../api.js';
import { Button, EmptyState, Icon, IconButton, SearchField, Segmented, Select } from '../../components/ui.js';
import { isCompact } from '../../components/media-query.js';
import { PlatformIcon } from '../../components/platform-icon.js';
import { addDays, addMonths, fmtMonthYear, monthGrid, today } from '../../time.js';
import { isValidDate } from '/shared/schemas/common.js';
import { SOCIAL_VIEWS, SocialList, SocialMonth, SocialYear } from './views.js';
import { PostOverlays } from './post-overlays.js';

/** @param {string} s */
const fold = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** @param {any} p @param {string} q */
export const postMatches = (p, q) => fold(`${p.title} ${p.caption} ${p.platform.name} ${p.format.name}`).includes(q);

export default function Social() {
  const { query, path, route } = useLocation();
  const compact = isCompact.value;
  const t0 = today();
  const remembered = store.get('social.view');
  const view = SOCIAL_VIEWS.includes(query.view) ? query.view : SOCIAL_VIEWS.includes(remembered) ? remembered : 'month';
  const anchor = query.date && isValidDate(query.date) ? query.date : t0;
  const platform = query.platform ?? '';
  const status = query.status ?? '';
  const q = query.q ?? '';

  usePageChrome(t('nav.social'), html`<a class="btn btn--primary btn--sm" href="?edit=new"><svg class="icon" aria-hidden="true"><use href="/icons.svg#i-plus"></use></svg>${t('social.newPost')}</a>`);

  useEffect(() => {
    loadPlatforms();
  }, []);
  useEffect(() => {
    store.set('social.view', view);
  }, [view]);

  /** @param {Record<string, string|null|undefined>} patch @param {boolean} [replace] */
  const nav = (patch, replace = false) => {
    const u = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') u.delete(k);
      else u.set(k, v);
    }
    const s = u.toString();
    route(`${path}${s ? `?${s}` : ''}`, replace);
  };

  // The visible period.
  const ym = anchor.slice(0, 7);
  const range = useMemo(() => {
    if (view === 'year') return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
    if (view === 'month') {
      const g = monthGrid(ym);
      return { from: g[0], to: g[g.length - 1] };
    }
    return { from: `${ym}-01`, to: addDays(addMonths(`${ym}-01`, 1), -1) };
  }, [view, anchor]);

  const [posts, setPosts] = useState(/** @type {any[]|null} */ (null));
  useEffect(() => {
    let live = true;
    api('GET', '/posts', { query: { from: range.from, to: range.to } }).then((r) => live && setPosts(r.items));
    return () => {
      live = false;
    };
  }, [range.from, range.to, postsRevision.value]);

  // Status and search apply to the counts; the platform tab filters on top.
  const base = useMemo(() => {
    let list = posts ?? [];
    if (status) list = list.filter((p) => p.status === status);
    const s = fold(q.trim());
    if (s) list = list.filter((p) => postMatches(p, s));
    return list;
  }, [posts, status, q]);
  const inPeriod = view === 'year' ? base : base.filter((p) => p.publish_date.startsWith(ym));
  const visible = platform ? base.filter((p) => p.platform_id === platform) : base;
  const shownCount = platform ? inPeriod.filter((p) => p.platform_id === platform).length : inPeriod.length;

  const tabs = (platforms.value ?? []).filter((p) => p.enabled || inPeriod.some((x) => x.platform_id === p.id));
  const step = (/** @type {number} */ dir) => nav({ date: view === 'year' ? `${Number(anchor.slice(0, 4)) + dir}-01-01` : addMonths(`${ym}-01`, dir) });
  const label = view === 'year' ? anchor.slice(0, 4) : fmtMonthYear(ym);
  const openPost = (/** @type {string} */ id) => nav({ post: id });
  const newPost = (/** @type {string} */ d) => nav({ edit: 'new', on: d });

  return html`<div class="calendar social stack" style=${{ '--stack-gap': 'var(--space-4)' }}>
    <div class="cal-head">
      <div class="cal-nav">
        <${IconButton} icon="chevron-left" variant="secondary" label=${t('calendar.previous')} onClick=${() => step(-1)} />
        <${IconButton} icon="chevron-right" variant="secondary" label=${t('calendar.next')} onClick=${() => step(1)} />
        <${Button} size="sm" onClick=${() => nav({ date: null })}>${t('calendar.today')}</${Button}>
        <h1 class="cal-label" aria-live="polite">${label}</h1>
      </div>
      <div class="cal-tools">
        <${Segmented} label=${t('calendar.view')} value=${view} onChange=${(/** @type {string} */ v) => nav({ view: v })}
          options=${[
            { value: 'year', label: t('social.viewYear') },
            { value: 'month', label: t('social.viewMonth') },
            { value: 'list', label: t('social.viewList') },
          ]} />
        <a class="btn btn--secondary" href="/social/queue"><${Icon} name="megaphone" /><span class=${compact ? 'sr-only' : ''}>${t('social.queue')}</span>
          ${counts.value.promotions > 0 && html`<span class="count count--accent" aria-label=${t('social.pendingCount', { n: counts.value.promotions })}>${counts.value.promotions}</span>`}</a>
        <a class="btn btn--secondary" href="/social/platforms"><${Icon} name="layers" /><span class=${compact ? 'sr-only' : ''}>${t('social.platforms')}</span></a>
        <${Button} variant="primary" icon="plus" class="hide-compact" onClick=${() => nav({ edit: 'new' })}>${t('social.newPost')}</${Button}>
      </div>
    </div>

    <nav class="platform-tabs" aria-label=${t('social.platformFilter')}>
      <button type="button" class="platform-tab" aria-pressed=${!platform ? 'true' : 'false'} onClick=${() => nav({ platform: null })}>
        <span>${t('social.allPlatforms')}</span><span class="count">${inPeriod.length}</span>
      </button>
      ${tabs.map((p) => {
        const n = inPeriod.filter((x) => x.platform_id === p.id).length;
        return html`<button type="button" class="platform-tab" aria-pressed=${platform === p.id ? 'true' : 'false'} style=${{ '--platform': p.color }}
          onClick=${() => nav({ platform: platform === p.id ? null : p.id })}>
          <${PlatformIcon} platform=${p} size=${16} /><span>${p.name}${!p.enabled ? ` ${t('social.disabledSuffix')}` : ''}</span><span class="count">${n}</span>
        </button>`;
      })}
    </nav>

    <div class="cal-subhead">
      <${SearchField} value=${q} onInput=${(/** @type {string} */ v) => nav({ q: v }, true)} placeholder=${t('social.search')} class="cal-search" />
      <${Select} value=${status} onChange=${(/** @type {string} */ v) => nav({ status: v })} aria-label=${t('social.statusFilter')}
        options=${[
          { value: '', label: t('social.allStatuses') },
          { value: 'draft', label: t('social.status_draft') },
          { value: 'scheduled', label: t('social.status_scheduled') },
          { value: 'published', label: t('social.status_published') },
        ]} />
      <span class="small muted" aria-live="polite">${posts && t('social.nPosts', { n: shownCount })}</span>
    </div>

    ${view === 'year'
      ? html`<${SocialYear} posts=${visible} anchor=${anchor} loading=${posts === null} openPost=${openPost} newPost=${newPost}
          goMonth=${(/** @type {string} */ d) => nav({ view: 'month', date: d })} />`
      : view === 'month'
        ? html`<${SocialMonth} posts=${visible} anchor=${anchor} loading=${posts === null} openPost=${openPost} newPost=${newPost} goMonth=${() => {}} />`
        : posts !== null && !visible.some((p) => p.publish_date.startsWith(ym))
          ? html`<${EmptyState} icon="megaphone" title=${t('social.emptyTitle')} text=${t('social.emptyText')}
              action=${html`<${Button} variant="primary" icon="plus" onClick=${() => nav({ edit: 'new' })}>${t('social.newPost')}</${Button}>`} />`
          : html`<${SocialList} posts=${visible.filter((p) => p.publish_date.startsWith(ym))} anchor=${anchor} loading=${posts === null}
              openPost=${openPost} newPost=${newPost} goMonth=${() => {}} />`}

    <${PostOverlays} />
  </div>`;
}
