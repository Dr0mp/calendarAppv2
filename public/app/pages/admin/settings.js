import { html, useEffect, useMemo, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { refreshSession, user as me } from '../../state/session.js';
import { api, ApiError } from '../../api.js';
import { Alert, Badge, Button, Field, Icon, Input, Meter, Select, SkeletonList, Textarea } from '../../components/ui.js';
import { confirm } from '../../components/overlay.js';
import { toast } from '../../components/toast.js';
import { fmtBytes } from '../../time.js';

const GB = 1024 ** 3;

export default function Settings() {
  const [s, setS] = useState(/** @type {any} */ (null));
  const [f, setF] = useState(/** @type {any} */ (null));
  const [errors, setErrors] = useState(/** @type {Record<string,string>} */ ({}));
  const [busy, setBusy] = useState(/** @type {string|null} */ (null));
  const readOnly = !!me.value?.isDemo;

  const load = async () => {
    const r = await api('GET', '/settings');
    setS(r);
    setF({ org_name: r.org_name, tz: r.tz, default_locale: r.default_locale, cap_gb: String(Math.round((r.storage_cap_bytes / GB) * 100) / 100), promo_template: r.promo_template });
  };
  useEffect(() => {
    load();
  }, []);

  const zones = useMemo(() => {
    try {
      return /** @type {any} */ (Intl).supportedValuesOf('timeZone');
    } catch {
      return ['Europe/Bucharest', 'UTC'];
    }
  }, []);

  if (!s || !f) return html`<${SkeletonList} rows=${4} />`;
  /** @param {string} k @param {string} v */
  const set = (k, v) => setF({ ...f, [k]: v });

  /** @param {string} section @param {Record<string, any>} body */
  async function save(section, body) {
    setBusy(section);
    setErrors({});
    try {
      await api('PATCH', '/settings', { body });
      toast('success', t('common.saved'));
      await load();
      await refreshSession();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, t(`errors.${v}`)])));
        if (!Object.keys(err.fields).length) toast('danger', err.text);
      }
    } finally {
      setBusy(null);
    }
  }

  async function testEmail() {
    setBusy('email');
    try {
      const r = await api('POST', '/settings/test-email', { body: {} });
      toast('success', t('admin.testEmailSent', { email: r.to }));
    } catch (err) {
      toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
    } finally {
      setBusy(null);
    }
  }

  async function resetDemo() {
    const ok = await confirm({ title: t('admin.resetDemoTitle'), message: t('admin.resetDemoText'), confirmLabel: t('admin.resetDemoNow'), danger: true });
    if (!ok) return;
    setBusy('demo');
    try {
      await api('POST', '/settings/demo-reset', { body: {} });
      toast('success', t('admin.demoReset'));
    } catch (err) {
      toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
    } finally {
      setBusy(null);
    }
  }

  const maxGb = Math.round((s.storage_cap_max_bytes / GB) * 100) / 100;

  return html`<div class="stack settings-page">
    <div class="page-head"><h1>${t('admin.settings')}</h1></div>
    ${readOnly && html`<${Alert} tone="info">${t('admin.demoSettingsReadOnly')}</${Alert}>`}

    <section class="card" aria-labelledby="set-org">
      <div class="card-head"><h2 id="set-org">${t('admin.organisation')}</h2></div>
      <form class="card-body stack" onSubmit=${(/** @type {Event} */ e) => (e.preventDefault(), save('org', { org_name: f.org_name, tz: f.tz, default_locale: f.default_locale }))}>
        <${Field} label=${t('admin.orgName')} error=${errors.org_name}>${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f.org_name} disabled=${readOnly} onInput=${(/** @type {string} */ v) => set('org_name', v)} />`}</${Field}>
        <div class="field-row">
          <${Field} label=${t('admin.timeZone')} error=${errors.tz} hint=${t('admin.timeZoneHint')}>
            ${(/** @type {any} */ a) => html`<${Select} ...${a} value=${f.tz} disabled=${readOnly} onChange=${(/** @type {string} */ v) => set('tz', v)} options=${zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))} />`}</${Field}>
          <${Field} label=${t('admin.defaultLanguage')}>
            ${(/** @type {any} */ a) => html`<${Select} ...${a} value=${f.default_locale} disabled=${readOnly} onChange=${(/** @type {string} */ v) => set('default_locale', v)}
              options=${[{ value: 'ro', label: 'Română' }, { value: 'en', label: 'English' }]} />`}</${Field}>
        </div>
        ${!readOnly && html`<div class="form-actions"><${Button} type="submit" variant="primary" busy=${busy === 'org'}>${t('common.save')}</${Button}></div>`}
      </form>
    </section>

    <section class="card" aria-labelledby="set-storage">
      <div class="card-head"><h2 id="set-storage">${t('admin.storageCap')}</h2></div>
      <form class="card-body stack" onSubmit=${(/** @type {Event} */ e) => (e.preventDefault(), save('cap', { storage_cap_bytes: Math.round(Number(f.cap_gb) * GB) }))}>
        <div class="stack" style=${{ '--stack-gap': 'var(--space-2)' }}>
          <${Meter} value=${s.storage.pct} label=${t('admin.storage')} level=${s.storage.level} />
          <span class="small muted">${t('admin.storageUsed', { used: fmtBytes(s.storage.used), cap: fmtBytes(s.storage.cap) })}</span>
        </div>
        <${Field} label=${t('admin.capGb')} error=${errors.storage_cap_bytes} hint=${t('admin.capHint', { max: maxGb })}>
          ${(/** @type {any} */ a) => html`<${Input} ...${a} type="number" step="0.5" min="0.5" max=${maxGb} value=${f.cap_gb} disabled=${readOnly || s.workspace === 'demo'}
            onInput=${(/** @type {string} */ v) => set('cap_gb', v)} />`}</${Field}>
        ${!readOnly && s.workspace === 'main' && html`<div class="form-actions"><${Button} type="submit" variant="primary" busy=${busy === 'cap'}>${t('common.save')}</${Button}></div>`}
      </form>
    </section>

    <section class="card" aria-labelledby="set-promo">
      <div class="card-head"><h2 id="set-promo">${t('admin.promoTemplate')}</h2></div>
      <form class="card-body stack" onSubmit=${(/** @type {Event} */ e) => (e.preventDefault(), save('promo', { promo_template: f.promo_template }))}>
        <p class="small muted">${t('admin.promoTemplateHelp')}</p>
        <div class="cluster">${['title', 'owner', 'date', 'time', 'space', 'price', 'enroll_url', 'description'].map((p) => html`<code class="chip">{${p}}</code>`)}</div>
        <${Field} label=${t('admin.promoTemplate')} error=${errors.promo_template}>
          ${(/** @type {any} */ a) => html`<${Textarea} ...${a} rows="8" value=${f.promo_template} disabled=${readOnly} onInput=${(/** @type {string} */ v) => set('promo_template', v)} />`}</${Field}>
        ${!readOnly && html`<div class="form-actions">
          <${Button} variant="ghost" onClick=${() => set('promo_template', s.default_promo_template)}>${t('admin.restoreDefault')}</${Button}>
          <${Button} type="submit" variant="primary" busy=${busy === 'promo'}>${t('common.save')}</${Button}>
        </div>`}
      </form>
    </section>

    <section class="card" aria-labelledby="set-email">
      <div class="card-head"><h2 id="set-email">${t('admin.email')}</h2>
        <${Badge} tone=${s.email.configured ? 'success' : 'warning'}>${s.email.configured ? t('admin.emailOn') : t('admin.emailOff')}</${Badge}></div>
      <div class="card-body stack">
        <p class="small muted">${s.email.configured ? t('admin.emailOnText', { from: s.email.from ?? '—' }) : t('admin.emailOffText')}</p>
        ${s.email.configured && !readOnly && html`<div><${Button} icon="send" busy=${busy === 'email'} onClick=${testEmail}>${t('admin.sendTestEmail')}</${Button}></div>`}
      </div>
    </section>

    <section class="card" aria-labelledby="set-demo">
      <div class="card-head"><h2 id="set-demo">${t('admin.demo')}</h2>
        <${Badge} tone=${s.demo.enabled ? 'success' : 'neutral'}>${s.demo.enabled ? t('admin.demoOn') : t('admin.demoOff')}</${Badge}></div>
      <div class="card-body stack">
        <p class="small muted">${s.demo.enabled ? t('admin.demoOnText', { hour: String(s.demo.resetHour).padStart(2, '0') }) : t('admin.demoOffText')}</p>
        ${s.demo.enabled && html`<div><${Button} icon="rotate-ccw" busy=${busy === 'demo'} onClick=${resetDemo}>${t('admin.resetDemoNow')}</${Button}></div>`}
      </div>
    </section>

    <section class="card" aria-labelledby="set-backup">
      <div class="card-head"><h2 id="set-backup">${t('admin.backup')}</h2></div>
      <div class="card-body stack">
        <p class="small muted">${t('admin.backupText')}</p>
        ${s.workspace === 'main' && !readOnly
          ? html`<div><a class="btn btn--secondary" href="/api/v1/backup" download><${Icon} name="download" />${t('admin.downloadBackup')}</a></div>`
          : html`<p class="small muted">${t('admin.backupDemo')}</p>`}
      </div>
    </section>
  </div>`;
}
