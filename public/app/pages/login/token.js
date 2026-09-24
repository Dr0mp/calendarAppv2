import { useLocation, useRoute } from 'preact-iso';
import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { session } from '../../state/session.js';
import { applyUserPrefs } from '../../state/prefs.js';
import { api, ApiError } from '../../api.js';
import { Alert, Button, Field, PasswordInput, Spinner } from '../../components/ui.js';
import { addPasskey, passkeysSupported } from '../../components/passkeys.js';
import { localPasswordError, passwordErrorText } from '../../components/password-errors.js';
import { toast } from '../../components/toast.js';
import { AuthCard } from './common.js';

/** Invitation acceptance (/invite/:token) and password reset (/reset/:token). @param {{purpose: 'invite'|'reset'}} p */
export default function TokenPage({ purpose }) {
  const { params } = useRoute();
  const { route } = useLocation();
  const [info, setInfo] = useState(/** @type {any} */ (null));
  const [invalid, setInvalid] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(/** @type {'password'|'passkey'} */ ('password'));

  useEffect(() => {
    api('GET', `/auth/token/${encodeURIComponent(params.token)}`)
      .then(setInfo)
      .catch(() => setInvalid(true));
  }, [params.token]);

  /** @param {Event} e */
  async function submit(e) {
    e.preventDefault();
    const local = localPasswordError(pw, { username: info.user.username });
    if (local) return setError(local);
    if (pw !== pw2) return setError(t('auth.passwordsDiffer'));
    setBusy(true);
    setError(null);
    try {
      const s = await api('POST', `/auth/token/${encodeURIComponent(params.token)}`, { body: { password: pw } });
      session.value = s;
      await applyUserPrefs();
      if (purpose === 'invite' && passkeysSupported()) setStep('passkey');
      else {
        toast('success', purpose === 'invite' ? t('auth.welcome', { name: s.user.name }) : t('auth.passwordReset'));
        route('/calendar', true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code.startsWith('password_')) setError(passwordErrorText(err.code));
      else if (err instanceof ApiError && err.code === 'token_invalid') setInvalid(true);
      else setError(err instanceof ApiError ? err.text : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function passkey() {
    setBusy(true);
    setError(null);
    try {
      await addPasskey();
      toast('success', t('account.passkeyAdded'));
      route('/calendar', true);
    } catch (err) {
      if (err instanceof ApiError) setError(err.text);
      else if (/** @type {any} */ (err)?.name !== 'NotAllowedError') setError(t('errors.passkey_failed'));
    } finally {
      setBusy(false);
    }
  }

  if (invalid) {
    return html`<${AuthCard} title=${t('auth.tokenInvalidTitle')}>
      <div class="stack"><${Alert} tone="warning">${t('auth.tokenInvalid')}</${Alert}>
        <${Button} href=${purpose === 'reset' ? '/forgot' : '/login'} block>${purpose === 'reset' ? t('auth.requestNewLink') : t('auth.backToSignIn')}</${Button}>
      </div>
    </${AuthCard}>`;
  }
  if (!info) return html`<${AuthCard} title="…"><div class="page-loading"><${Spinner} /></div></${AuthCard}>`;

  if (step === 'passkey') {
    return html`<${AuthCard} title=${t('auth.addPasskeyTitle')} sub=${t('auth.addPasskeySub')}>
      <div class="stack">
        ${error && html`<${Alert} tone="danger">${error}</${Alert}>`}
        <${Button} variant="primary" size="lg" icon="fingerprint" block busy=${busy} onClick=${passkey}>${t('account.addPasskey')}</${Button}>
        <${Button} variant="ghost" block onClick=${() => route('/calendar', true)}>${t('auth.skipForNow')}</${Button}>
      </div>
    </${AuthCard}>`;
  }

  return html`<${AuthCard} title=${purpose === 'invite' ? t('auth.inviteTitle', { name: info.user.name }) : t('auth.resetTitle')}
    sub=${purpose === 'invite' ? t('auth.inviteSub', { username: info.user.username }) : t('auth.resetSub')}>
    <form class="stack" onSubmit=${submit} noValidate>
      ${error && html`<${Alert} tone="danger">${error}</${Alert}>`}
      <input type="text" name="username" value=${info.user.username} autocomplete="username" hidden readOnly />
      <${Field} label=${t('auth.newPassword')} hint=${t('auth.passwordHint')}>
        ${(/** @type {any} */ a) => html`<${PasswordInput} ...${a} value=${pw} onInput=${setPw} meter autocomplete="new-password" />`}
      </${Field}>
      <${Field} label=${t('auth.repeatPassword')}>
        ${(/** @type {any} */ a) => html`<${PasswordInput} ...${a} value=${pw2} onInput=${setPw2} autocomplete="new-password" />`}
      </${Field}>
      <${Button} type="submit" variant="primary" size="lg" block busy=${busy}>${t('auth.setPassword')}</${Button}>
    </form>
  </${AuthCard}>`;
}
