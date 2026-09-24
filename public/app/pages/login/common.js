import { html } from '../../html.js';
import { t, locale } from '../../i18n/index.js';
import { theme, setTheme, setLocale } from '../../state/prefs.js';
import { IconButton } from '../../components/ui.js';

/** The centred card used by sign-in, forgot-password and token pages. @param {{children: any, title: string, sub?: any}} p */
export function AuthCard({ children, title, sub }) {
  const nextTheme = theme.value === 'dark' ? 'light' : theme.value === 'light' ? 'system' : 'dark';
  const themeIcon = theme.value === 'dark' ? 'moon' : theme.value === 'light' ? 'sun' : 'monitor';
  return html`<div class="auth">
    <div class="auth-card card">
      <div class="auth-top">
        <div class="brand"><span class="brand-mark" aria-hidden="true">CA</span><span>Casa Artis</span></div>
        <div class="cluster" style=${{ '--cluster-gap': 'var(--space-1)' }}>
          <button type="button" class="btn btn--ghost btn--sm" onClick=${() => setLocale(locale.value === 'ro' ? 'en' : 'ro')}
            aria-label=${t('prefs.switchLanguage')}>${locale.value === 'ro' ? 'EN' : 'RO'}</button>
          <${IconButton} icon=${themeIcon} size="sm" label=${t('prefs.themeNow', { theme: t(`prefs.theme${theme.value[0].toUpperCase()}${theme.value.slice(1)}`) })}
            onClick=${() => setTheme(nextTheme)} />
        </div>
      </div>
      <h1 class="auth-title">${title}</h1>
      ${sub && html`<p class="auth-sub">${sub}</p>`}
      ${children}
    </div>
    <p class="auth-foot xs muted">© Casa Artis</p>
  </div>`;
}
