import { html, useEffect, useState } from '../../html.js';
import { t, locale } from '../../i18n/index.js';
import { session, user } from '../../state/session.js';
import { theme, setTheme, setLocale } from '../../state/prefs.js';
import { usePageChrome } from '../../state/chrome.js';
import { api, ApiError } from '../../api.js';
import { Alert, Avatar, Badge, Button, Field, IconButton, Input, PasswordInput, Segmented, Skeleton } from '../../components/ui.js';
import { confirm } from '../../components/overlay.js';
import { toast } from '../../components/toast.js';
import { addPasskey, passkeysSupported } from '../../components/passkeys.js';
import { localPasswordError, passwordErrorText } from '../../components/password-errors.js';
import { fmtInstant } from '../../time.js';

export default function Account() {
  usePageChrome(t('account.title'));
  const u = /** @type {any} */ (user.value);
  useEffect(() => {
    if (location.hash === '#passkeys') document.getElementById('passkeys')?.scrollIntoView();
  }, []);
  return html`<div class="page-account">
    <div class="page-head"><h1>${t('account.title')}</h1></div>
    <div class="account-grid">
      <${Profile} />
      <${Preferences} />
      ${!u.isDemo && html`<${ChangePassword} />`}
      ${!u.isDemo && html`<${Passkeys} />`}
      <${Sessions} />
    </div>
  </div>`;
}

function Profile() {
  const u = /** @type {any} */ (user.value);
  const [name, setName] = useState(u.name);
  const [email, setEmail] = useState(u.email ?? '');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState(/** @type {Record<string,string>} */ ({}));

  /** @param {Event} e */
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const updated = await api('PATCH', '/me', { body: { name, email: email || undefined }, version: u.version });
      session.value = { ...session.value, user: { ...u, ...updated } };
      toast('success', t('common.saved'));
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'version_conflict') {
          toast('warning', t('errors.version_conflict'));
          const fresh = await api('GET', '/me');
          session.value = { ...session.value, user: { ...u, ...fresh } };
        } else setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, t(`errors.${v}`)])));
        if (!Object.keys(err.fields).length && err.code !== 'version_conflict') toast('danger', err.text);
      }
    } finally {
      setBusy(false);
    }
  }

  return html`<section class="card" aria-labelledby="acc-profile">
    <div class="card-head"><h2 id="acc-profile">${t('account.profile')}</h2></div>
    <form class="card-body stack" onSubmit=${save} noValidate>
      <div class="cluster" style=${{ '--cluster-gap': 'var(--space-3)' }}>
        <${Avatar} name=${u.name} color=${u.color} initials=${u.initials} size="lg" />
        <div><div class="strong">@${u.username}</div><${Badge}>${t(`roles.${u.role}`)}</${Badge}></div>
      </div>
      <${Field} label=${t('account.name')} error=${errors.name} required>
        ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${name} onInput=${setName} disabled=${u.isDemo} autocomplete="name" />`}
      </${Field}>
      <${Field} label=${t('account.email')} error=${errors.email}>
        ${(/** @type {any} */ a) => html`<${Input} ...${a} type="email" value=${email} onInput=${setEmail} disabled=${u.isDemo} autocomplete="email" />`}
      </${Field}>
      ${!u.isDemo && html`<div class="form-actions"><${Button} type="submit" variant="primary" busy=${busy}>${t('common.save')}</${Button}></div>`}
    </form>
  </section>`;
}

function Preferences() {
  return html`<section class="card" aria-labelledby="acc-prefs">
    <div class="card-head"><h2 id="acc-prefs">${t('account.preferences')}</h2></div>
    <div class="card-body stack">
      <div class="field"><span class="field-label">${t('prefs.language')}</span>
        <${Segmented} label=${t('prefs.language')} value=${locale.value} onChange=${(/** @type {any} */ v) => setLocale(v)}
          options=${[{ value: 'ro', label: 'Română' }, { value: 'en', label: 'English' }]} />
      </div>
      <div class="field"><span class="field-label">${t('prefs.theme')}</span>
        <${Segmented} label=${t('prefs.theme')} value=${theme.value} onChange=${(/** @type {any} */ v) => setTheme(v)}
          options=${[
            { value: 'system', label: t('prefs.themeSystem'), icon: 'monitor' },
            { value: 'light', label: t('prefs.themeLight'), icon: 'sun' },
            { value: 'dark', label: t('prefs.themeDark'), icon: 'moon' },
          ]} />
      </div>
    </div>
  </section>`;
}

function ChangePassword() {
  const u = /** @type {any} */ (user.value);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState(/** @type {Record<string,string|null>} */ ({}));

  /** @param {Event} e */
  async function submit(e) {
    e.preventDefault();
    const local = localPasswordError(next, { username: u.username, email: u.email });
    if (!current) return setErrors({ current: t('errors.required') });
    if (local) return setErrors({ next: local });
    setBusy(true);
    setErrors({});
    try {
      const r = await api('POST', '/me/password', { body: { currentPassword: current, newPassword: next } });
      session.value = { ...session.value, csrfToken: r.csrfToken };
      setCurrent('');
      setNext('');
      toast('success', t('account.passwordChanged'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_current_password') setErrors({ current: err.text });
      else if (err instanceof ApiError && err.code.startsWith('password_')) setErrors({ next: passwordErrorText(err.code) });
      else toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  return html`<section class="card" aria-labelledby="acc-pw">
    <div class="card-head"><h2 id="acc-pw">${t('account.changePassword')}</h2></div>
    <form class="card-body stack" onSubmit=${submit} noValidate>
      <input type="text" name="username" value=${u.username} autocomplete="username" hidden readOnly />
      <${Field} label=${t('account.currentPassword')} error=${errors.current}>
        ${(/** @type {any} */ a) => html`<${PasswordInput} ...${a} value=${current} onInput=${setCurrent} autocomplete="current-password" />`}
      </${Field}>
      <${Field} label=${t('auth.newPassword')} hint=${t('auth.passwordHint')} error=${errors.next}>
        ${(/** @type {any} */ a) => html`<${PasswordInput} ...${a} value=${next} onInput=${setNext} meter autocomplete="new-password" />`}
      </${Field}>
      <p class="small muted">${t('account.passwordChangeNote')}</p>
      <div class="form-actions"><${Button} type="submit" variant="primary" busy=${busy}>${t('account.changePassword')}</${Button}></div>
    </form>
  </section>`;
}

function Passkeys() {
  const [items, setItems] = useState(/** @type {any[]|null} */ (null));
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const load = () => api('GET', '/me/passkeys').then((r) => setItems(r.items));
  useEffect(() => {
    load();
  }, []);

  async function add() {
    setBusy(true);
    try {
      await addPasskey(name.trim());
      setName('');
      toast('success', t('account.passkeyAdded'));
      await load();
    } catch (err) {
      if (err instanceof ApiError) toast('danger', err.text);
      else if (/** @type {any} */ (err)?.name !== 'NotAllowedError') toast('danger', t('errors.passkey_failed'));
    } finally {
      setBusy(false);
    }
  }

  /** @param {any} p */
  async function rename(p) {
    const value = await promptName(p.name);
    if (!value) return;
    await api('PATCH', `/me/passkeys/${encodeURIComponent(p.id)}`, { body: { name: value } });
    toast('success', t('common.saved'));
    load();
  }

  /** @param {any} p */
  async function remove(p) {
    const ok = await confirm({ title: t('account.removePasskeyTitle'), message: t('account.removePasskeyText', { name: p.name }), danger: true, confirmLabel: t('common.remove') });
    if (!ok) return;
    await api('DELETE', `/me/passkeys/${encodeURIComponent(p.id)}`);
    toast('success', t('account.passkeyRemoved'));
    load();
  }

  return html`<section class="card" id="passkeys" aria-labelledby="acc-pk">
    <div class="card-head"><h2 id="acc-pk">${t('account.passkeys')}</h2></div>
    <div class="card-body stack">
      <p class="muted">${t('account.passkeysIntro')}</p>
      ${items === null
        ? html`<${Skeleton} h="48px" />`
        : items.length === 0
          ? html`<p class="small muted">${t('account.noPasskeys')}</p>`
          : html`<ul class="list-rows" role="list">
              ${items.map(
                (p) => html`<li class="list-row">
                  <span class="icon-circle"><svg class="icon" aria-hidden="true"><use href="/icons.svg#i-key-round"></use></svg></span>
                  <div class="grow"><div class="strong truncate">${p.name}</div>
                    <div class="xs muted">${t('account.passkeyMeta', { created: fmtInstant(p.createdAt), used: p.lastUsedAt ? fmtInstant(p.lastUsedAt) : t('common.never') })}</div></div>
                  <${IconButton} icon="pencil" label=${t('common.rename')} onClick=${() => rename(p)} />
                  <${IconButton} icon="trash-2" label=${t('common.remove')} onClick=${() => remove(p)} />
                </li>`,
              )}
            </ul>`}
      ${passkeysSupported()
        ? html`<div class="cluster">
            <input class="input grow" style=${{ maxInlineSize: '260px' }} placeholder=${t('account.passkeyNameOptional')} value=${name}
              aria-label=${t('account.passkeyNameOptional')} onInput=${(/** @type {any} */ e) => setName(e.currentTarget.value)} />
            <${Button} icon="plus" busy=${busy} onClick=${add}>${t('account.addPasskey')}</${Button}>
          </div>`
        : html`<${Alert} tone="info">${t('account.passkeysUnsupported')}</${Alert}>`}
    </div>
  </section>`;
}

/** Ask for a new name with the app's own dialog (never window.prompt). @param {string} current */
async function promptName(current) {
  return confirm({ title: t('common.rename'), input: { label: t('account.passkeyName'), value: current, max: 60 }, confirmLabel: t('common.save') });
}

function Sessions() {
  const [items, setItems] = useState(/** @type {any[]|null} */ (null));
  const load = () => api('GET', '/me/sessions').then((r) => setItems(r.items));
  useEffect(() => {
    load();
  }, []);

  /** @param {any} s */
  async function revoke(s) {
    await api('DELETE', `/me/sessions/${s.id}`);
    toast('success', t('account.sessionRevoked'));
    load();
  }

  async function signOutEverywhere() {
    const ok = await confirm({ title: t('account.signOutEverywhere'), message: t('account.signOutEverywhereText'), confirmLabel: t('account.signOutEverywhere'), danger: true });
    if (!ok) return;
    await api('POST', '/auth/logout-all', { body: {} });
    location.assign('/login');
  }

  return html`<section class="card" aria-labelledby="acc-sessions">
    <div class="card-head"><h2 id="acc-sessions">${t('account.activeSessions')}</h2></div>
    <div class="card-body stack">
      ${items === null
        ? html`<${Skeleton} h="48px" />`
        : html`<ul class="list-rows" role="list">
            ${items.map(
              (s) => html`<li class="list-row">
                <span class="icon-circle"><svg class="icon" aria-hidden="true"><use href=${`/icons.svg#i-${/Mobile|Android|iPhone/.test(s.userAgent ?? '') ? 'smartphone' : 'laptop'}`}></use></svg></span>
                <div class="grow">
                  <div class="strong truncate">${describeAgent(s.userAgent)} ${s.current && html`<${Badge} tone="success">${t('account.thisDevice')}</${Badge}>`}</div>
                  <div class="xs muted">${t('account.lastSeen', { when: fmtInstant(s.lastSeenAt) })}${s.ip ? ` · ${s.ip}` : ''}</div>
                </div>
                ${!s.current && html`<${Button} size="sm" variant="danger-ghost" onClick=${() => revoke(s)}>${t('account.revoke')}</${Button}>`}
              </li>`,
            )}
          </ul>`}
      <div><${Button} icon="log-out" variant="danger-ghost" onClick=${signOutEverywhere}>${t('account.signOutEverywhere')}</${Button}></div>
    </div>
  </section>`;
}

/** "Firefox · Windows" from a user agent. @param {string|null} ua */
function describeAgent(ua) {
  if (!ua) return t('account.unknownDevice');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : t('account.browser');
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}
