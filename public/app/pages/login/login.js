import { useLocation } from 'preact-iso';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { html, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { session } from '../../state/session.js';
import { applyUserPrefs } from '../../state/prefs.js';
import { api, ApiError } from '../../api.js';
import { Alert, Button, Field, Icon, Input, PasswordInput } from '../../components/ui.js';
import { AuthCard } from './common.js';
import { afterLogin } from '../../shell.js';

const passkeysSupported = () => window.isSecureContext && browserSupportsWebAuthn();

/** @param {{next?: string|null}} p */
export default function Login({ next }) {
  const { route, query } = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(/** @type {string|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const target = next ?? query.next ?? null;
  const demo = session.value?.features.demo;

  /** @param {any} s */
  async function done(s) {
    session.value = s;
    await applyUserPrefs();
    route(afterLogin(target), true);
  }

  /** @param {Event} e */
  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError(t('auth.fillBoth'));
      return;
    }
    setBusy('password');
    try {
      // The client trims usernames; passwords are never trimmed.
      await done(await api('POST', '/auth/login', { body: { username: username.trim(), password } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.text : t('errors.generic'));
    } finally {
      setBusy(null);
    }
  }

  async function passkey() {
    setError(null);
    setBusy('passkey');
    try {
      const optionsJSON = await api('POST', '/auth/passkey/options', { body: {} });
      const response = await startAuthentication({ optionsJSON });
      await done(await api('POST', '/auth/passkey/verify', { body: { response } }));
    } catch (err) {
      if (err instanceof ApiError) setError(err.text);
      else if (/** @type {any} */ (err)?.name !== 'NotAllowedError') setError(t('errors.passkey_failed'));
    } finally {
      setBusy(null);
    }
  }

  /** @param {'demo'|'demo_admin'} account */
  async function demoLogin(account) {
    setError(null);
    setBusy(account);
    try {
      await done(await api('POST', '/auth/demo', { body: { account } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.text : t('errors.generic'));
    } finally {
      setBusy(null);
    }
  }

  return html`<${AuthCard} title=${t('auth.signInTitle')} sub=${t('auth.signInSub')}>
    <form class="stack" onSubmit=${submit} noValidate>
      ${error && html`<${Alert} tone="danger">${error}</${Alert}>`}
      <${Field} label=${t('auth.username')}>
        ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${username} onInput=${setUsername} autocomplete="username webauthn"
          autocapitalize="none" spellcheck="false" name="username" />`}
      </${Field}>
      <${Field} label=${t('auth.password')}>
        ${(/** @type {any} */ a) => html`<${PasswordInput} ...${a} value=${password} onInput=${setPassword} name="password" />`}
      </${Field}>
      <div class="cluster" style=${{ justifyContent: 'flex-end' }}>
        <a href="/forgot" class="small">${t('auth.forgot')}</a>
      </div>
      <${Button} type="submit" variant="primary" size="lg" block busy=${busy === 'password'}>${t('auth.signIn')}</${Button}>
    </form>
    ${passkeysSupported() &&
    html`<div class="divider-text">${t('auth.or')}</div>
      <${Button} size="lg" block icon="fingerprint" busy=${busy === 'passkey'} onClick=${passkey}>${t('auth.signInPasskey')}</${Button}>`}
    ${demo &&
    html`<div class="auth-demo">
      <div class="section-title">${t('auth.demoTitle')}</div>
      <div class="cluster">
        <button type="button" class="chip" onClick=${() => demoLogin('demo')} aria-busy=${busy === 'demo' ? 'true' : undefined}>
          <${Icon} name="user" />${t('auth.demoUser')}</button>
        <button type="button" class="chip" onClick=${() => demoLogin('demo_admin')} aria-busy=${busy === 'demo_admin' ? 'true' : undefined}>
          <${Icon} name="shield" />${t('auth.demoAdmin')}</button>
      </div>
      <p class="xs muted">${t('auth.demoNote')}</p>
    </div>`}
  </${AuthCard}>`;
}
