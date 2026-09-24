import { html, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { api, ApiError } from '../../api.js';
import { Alert, Button, Field, Input } from '../../components/ui.js';
import { AuthCard } from './common.js';

export default function Forgot() {
  const [login, setLogin] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));

  /** @param {Event} e */
  async function submit(e) {
    e.preventDefault();
    if (!login.trim()) {
      setError(t('errors.required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/auth/forgot', { body: { login: login.trim() } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.text : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  return html`<${AuthCard} title=${t('auth.forgotTitle')} sub=${sent ? null : t('auth.forgotSub')}>
    ${sent
      ? html`<div class="stack"><${Alert} tone="success">${t('auth.forgotSent')}</${Alert}>
          <${Button} href="/login" block>${t('auth.backToSignIn')}</${Button}></div>`
      : html`<form class="stack" onSubmit=${submit} noValidate>
          ${error && html`<${Alert} tone="danger">${error}</${Alert}>`}
          <${Field} label=${t('auth.usernameOrEmail')}>
            ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${login} onInput=${setLogin} autocomplete="username" autocapitalize="none" />`}
          </${Field}>
          <${Button} type="submit" variant="primary" size="lg" block busy=${busy}>${t('auth.sendResetLink')}</${Button}>
          <a href="/login" class="small" style=${{ textAlign: 'center' }}>${t('auth.backToSignIn')}</a>
        </form>`}
  </${AuthCard}>`;
}
