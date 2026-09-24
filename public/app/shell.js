import { LocationProvider, Router, Route, ErrorBoundary, useLocation } from 'preact-iso';
import { html, useEffect, useState } from './html.js';
import { t, locale } from './i18n/index.js';
import { session, user, isAdmin, isDemo, refreshSession } from './state/session.js';
import { store, theme, setTheme, setLocale, applyUserPrefs } from './state/prefs.js';
import { chrome } from './state/chrome.js';
import { counts, refreshCounts } from './state/counts.js';
import { pages, PUBLIC, allowed } from './router.js';
import { Avatar, Button, Icon, Segmented, Badge } from './components/ui.js';
import { Modal, ConfirmHost, Popover, MenuItem, menuKeys } from './components/overlay.js';
import { Toaster, toast } from './components/toast.js';
import { api } from './api.js';
import { isCompact } from './components/media-query.js';

export function App() {
  return html`<${LocationProvider}><${Gate} /></${LocationProvider}>`;
}

function Gate() {
  const { path, url } = useLocation();
  const u = user.value;
  const isPublic = PUBLIC.some((re) => re.test(path));

  // Remember the last visited page (per browser) for the post-sign-in redirect.
  useEffect(() => {
    if (u && !isPublic && path !== '/') store.set('lastPath', url);
  }, [url, u]);

  if (isPublic) {
    if (u && (path === '/login' || path === '/forgot')) {
      return html`<${Redirect} to=${afterLogin(new URLSearchParams(url.split('?')[1] ?? '').get('next'))} />`;
    }
    return html`<${ErrorBoundary}>
      <${Router}>
        <${Route} path="/login" component=${pages.login} />
        <${Route} path="/forgot" component=${pages.forgot} />
        <${Route} path="/invite/:token" component=${pages.token} purpose="invite" />
        <${Route} path="/reset/:token" component=${pages.token} purpose="reset" />
      </${Router}>
      <${Toaster} />
    </${ErrorBoundary}>`;
  }
  if (!u) {
    const Login = pages.login;
    return html`<${Login} next=${path === '/' ? null : url} /><${Toaster} />`;
  }
  if (path === '/') return html`<${Redirect} to="/calendar" />`;
  return html`<${Shell} />`;
}

/** @param {{to: string}} p */
function Redirect({ to }) {
  const { route } = useLocation();
  useEffect(() => route(to, true), [to]);
  return null;
}

/** Where to go after sign-in. @param {string|null|undefined} next */
export function afterLogin(next) {
  const u = user.value;
  if (next && next.startsWith('/') && !next.startsWith('//') && allowed(next.split('?')[0], u)) return next;
  const last = store.get('lastPath');
  if (typeof last === 'string' && last.startsWith('/') && allowed(last.split('?')[0], u)) return last;
  return '/calendar';
}

function Shell() {
  const { path } = useLocation();
  const u = /** @type {NonNullable<typeof user.value>} */ (user.value);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    refreshCounts();
  }, [path]);

  // Keep the session (and storage level) fresh when the tab regains focus.
  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 30_000) return;
      last = Date.now();
      refreshSession().then(() => refreshCounts());
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const tabs = [
    { href: '/calendar', icon: 'calendar-days', label: t('nav.calendar'), short: t('nav.calendar'), match: /^\/(calendar|entries)/ },
    { href: '/schedule', icon: 'calendar-plus', label: t('nav.schedule'), short: t('nav.schedule'), match: /^\/schedule/ },
    { href: '/my-events', icon: 'list', label: t('nav.myEvents'), short: t('nav.mine'), match: /^\/my-events/, count: counts.value.myUpcoming },
    ...(isAdmin.value
      ? [{ href: '/social', icon: 'megaphone', label: t('nav.social'), short: t('nav.social'), match: /^\/social/, count: null }]
      : []),
  ];
  const storageLevel = session.value?.storage;
  const Routes = routesFor();

  return html`<div class="app">
    <a class="skip-link" href="#main">${t('nav.skipToContent')}</a>
    ${isDemo.value && html`<div class="demo-banner" role="note"><${Icon} name="sparkles" />${t('shell.demoBanner')}</div>`}
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/calendar" aria-label="Casa Artis">
          <span class="brand-mark" aria-hidden="true">CA</span><span class="brand-name">Casa Artis</span>
        </a>
        <nav class="topnav" aria-label=${t('nav.main')}>
          ${tabs.map(
            (x) => html`<a class="topnav-link" href=${x.href} aria-current=${x.match.test(path) ? 'page' : undefined}>
              <${Icon} name=${x.icon} />${x.label}${x.count ? html`<span class="count" aria-label=${t('nav.countUpcoming', { n: x.count })}>${x.count}</span>` : null}
            </a>`,
          )}
        </nav>
        <h1 class="topbar-title">${chrome.value.title}</h1>
        <div class="topbar-end">
          ${isCompact.value && chrome.value.action}
          ${isAdmin.value &&
          html`<a class="topnav-link admin-link hide-compact" href="/admin" aria-current=${path.startsWith('/admin') ? 'page' : undefined}>
            <${Icon} name="shield" />${t('nav.admin')}
            ${storageLevel && html`<span class=${`dot ${storageLevel === 'warn' ? 'dot--warning' : 'dot--danger'}`} title=${t('nav.storageAlert')}
              role="img" aria-label=${t('nav.storageAlert')}></span>`}
          </a>`}
          <${UserMenu} user=${u} />
        </div>
      </div>
    </header>
    <main class="main" id="main" tabindex="-1">
      <${ErrorBoundary} onError=${(/** @type {Error} */ e) => console.error(e)}>
        <${Routes} />
      </${ErrorBoundary}>
    </main>
    <nav class="tabbar" aria-label=${t('nav.main')}>
      ${tabs.map(
        (x) => html`<a class="tabbar-link" href=${x.href} aria-current=${x.match.test(path) ? 'page' : undefined}>
          <${Icon} name=${x.icon} /><span>${x.short}</span>
          ${x.count ? html`<span class="count count--accent tab-badge" aria-label=${t('nav.countUpcoming', { n: x.count })}>${x.count}</span>` : null}
        </a>`,
      )}
      <button type="button" class="tabbar-link" aria-haspopup="dialog" aria-expanded=${moreOpen ? 'true' : 'false'}
        aria-current=${/^\/(admin|account)/.test(path) ? 'page' : undefined} onClick=${() => setMoreOpen(true)}>
        <${Icon} name="ellipsis" /><span>${t('nav.more')}</span>
        ${isAdmin.value && storageLevel && html`<span class=${`dot tab-badge ${storageLevel === 'warn' ? 'dot--warning' : 'dot--danger'}`}></span>`}
      </button>
    </nav>
    <${MoreSheet} open=${moreOpen} onClose=${() => setMoreOpen(false)} />
    <${Toaster} />
    <${ConfirmHost} />
  </div>`;
}

let RoutesComponent = /** @type {any} */ (null);
function routesFor() {
  if (RoutesComponent) return RoutesComponent;
  RoutesComponent = function Routes() {
    const u = user.value;
    return html`<${Router}>
      <${Route} path="/calendar" component=${pages.calendar} />
      <${Route} path="/schedule" component=${pages.schedule} />
      <${Route} path="/entries/:id/edit" component=${pages.schedule} />
      <${Route} path="/entries/:id" component=${pages.entry} />
      <${Route} path="/my-events" component=${pages.myEntries} />
      <${Route} path="/account" component=${pages.account} />
      <${Route} path="/social" component=${u?.role === 'admin' ? pages.social : Forbidden} />
      <${Route} path="/social/platforms" component=${u?.role === 'admin' ? pages.platforms : Forbidden} />
      <${Route} path="/social/standards" component=${u?.role === 'admin' ? pages.standards : Forbidden} />
      <${Route} path="/admin" component=${u?.role === 'admin' ? pages.admin : Forbidden} />
      <${Route} path="/admin/:section" component=${u?.role === 'admin' ? pages.admin : Forbidden} />
      <${Route} path="/dev/styleguide" component=${u?.role === 'admin' && session.value?.features.dev ? pages.styleguide : Forbidden} />
      <${Route} default component=${NotFound} />
    </${Router}>`;
  };
  return RoutesComponent;
}

function Forbidden() {
  return html`<div class="empty mt-6">
    <div class="empty-icon"><${Icon} name="lock" /></div>
    <h2>${t('shell.forbiddenTitle')}</h2>
    <p>${t('shell.forbiddenText')}</p>
    <${Button} variant="primary" href="/calendar">${t('shell.backToCalendar')}</${Button}>
  </div>`;
}

function NotFound() {
  return html`<div class="empty mt-6">
    <div class="empty-icon"><${Icon} name="search" /></div>
    <h2>${t('shell.notFoundTitle')}</h2>
    <p>${t('shell.notFoundText')}</p>
    <${Button} variant="primary" href="/calendar">${t('shell.backToCalendar')}</${Button}>
  </div>`;
}

async function signOut() {
  try {
    await api('POST', '/auth/logout');
  } catch {
    /* already signed out */
  }
  await refreshSession();
  await applyUserPrefs();
  location.assign('/login');
}

function ThemeSwitch() {
  return html`<${Segmented} label=${t('prefs.theme')} value=${theme.value} onChange=${(/** @type {any} */ v) => setTheme(v)} block
    options=${[
      { value: 'system', label: t('prefs.themeSystem'), icon: 'monitor' },
      { value: 'light', label: t('prefs.themeLight'), icon: 'sun' },
      { value: 'dark', label: t('prefs.themeDark'), icon: 'moon' },
    ]} />`;
}

function LanguageSwitch() {
  return html`<${Segmented} label=${t('prefs.language')} value=${locale.value} onChange=${(/** @type {any} */ v) => setLocale(v)} block
    options=${[
      { value: 'ro', label: 'Română' },
      { value: 'en', label: 'English' },
    ]} />`;
}

/** @param {{user: any}} p */
function UserMenu({ user: u }) {
  return html`<${Popover} align="end" label=${t('nav.userMenu')}
    trigger=${(/** @type {any} */ p) => html`<button type="button" class="btn btn--ghost user-menu-trigger hide-compact" ref=${p.ref} onClick=${p.toggle}
      aria-expanded=${p['aria-expanded']} aria-haspopup="true" aria-label=${t('nav.userMenu')}>
      <${Avatar} name=${u.name} color=${u.color} initials=${u.initials} size="sm" />
      <span class="truncate hide-compact">${u.name}</span><${Icon} name="chevron-down" />
    </button>`}>
    ${(/** @type {() => void} */ close) => html`<div class="menu" role="menu" onKeyDown=${menuKeys}>
      <div class="menu-head">
        <${Avatar} name=${u.name} color=${u.color} initials=${u.initials} />
        <div class="grow"><div class="strong truncate">${u.name}</div><div class="xs muted">${t(`roles.${u.role}`)}</div></div>
      </div>
      <hr />
      <${MenuItem} icon="settings" href="/account" onClick=${close}>${t('nav.account')}</${MenuItem}>
      ${!u.isDemo && html`<${MenuItem} icon="key-round" href="/account#passkeys" onClick=${close}>${t('nav.passkeys')}</${MenuItem}>`}
      <hr />
      <div class="stack" style=${{ padding: 'var(--space-2) var(--space-3)', '--stack-gap': 'var(--space-3)' }}>
        <div class="stack" style=${{ '--stack-gap': 'var(--space-1)' }}><span class="section-title">${t('prefs.language')}</span><${LanguageSwitch} /></div>
        <div class="stack" style=${{ '--stack-gap': 'var(--space-1)' }}><span class="section-title">${t('prefs.theme')}</span><${ThemeSwitch} /></div>
      </div>
      <hr />
      <${MenuItem} icon="log-out" onClick=${signOut}>${t('nav.signOut')}</${MenuItem}>
    </div>`}
  </${Popover}>`;
}

/** @param {{open: boolean, onClose: () => void}} p */
function MoreSheet({ open, onClose }) {
  const u = user.value;
  if (!u) return null;
  return html`<${Modal} open=${open} onClose=${onClose} kind="sheet" title=${t('nav.more')}>
    <div class="stack">
      <div class="cluster" style=${{ '--cluster-gap': 'var(--space-3)' }}>
        <${Avatar} name=${u.name} color=${u.color} initials=${u.initials} size="lg" />
        <div class="grow"><div class="strong">${u.name}</div><${Badge}>${t(`roles.${u.role}`)}</${Badge}></div>
      </div>
      <div class="menu" role="menu">
        ${isAdmin.value && html`<${MenuItem} icon="shield" href="/admin" onClick=${onClose}
          end=${session.value?.storage && html`<span class=${`dot ${session.value.storage === 'warn' ? 'dot--warning' : 'dot--danger'}`}></span>`}>${t('nav.admin')}</${MenuItem}>`}
        <${MenuItem} icon="settings" href="/account" onClick=${onClose}>${t('nav.account')}</${MenuItem}>
      </div>
      <div class="stack" style=${{ '--stack-gap': 'var(--space-1)' }}><span class="section-title">${t('prefs.language')}</span><${LanguageSwitch} /></div>
      <div class="stack" style=${{ '--stack-gap': 'var(--space-1)' }}><span class="section-title">${t('prefs.theme')}</span><${ThemeSwitch} /></div>
      <${Button} icon="log-out" block onClick=${signOut}>${t('nav.signOut')}</${Button}>
    </div>
  </${Modal}>`;
}

export { toast };
