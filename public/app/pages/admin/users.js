import { html, useEffect, useMemo, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { user as me, isDemo as isDemoWs } from '../../state/session.js';
import { api, ApiError } from '../../api.js';
import {
  Alert, Avatar, Badge, Button, Checkbox, ColorPicker, EmptyState, Field, Icon, Input, SearchField, Select, SkeletonList,
} from '../../components/ui.js';
import { Modal, Popover, MenuItem, menuKeys, confirm } from '../../components/overlay.js';
import { DataTable } from '../../components/table.js';
import { toast } from '../../components/toast.js';
import { copyText } from '../../components/clipboard.js';
import { fmtInstant, fmtDate } from '../../time.js';

const ROLES = ['user', 'moderator', 'admin'];

export default function Users() {
  const [items, setItems] = useState(/** @type {any[]|null} */ (null));
  const [emailOn, setEmailOn] = useState(false);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState(/** @type {null | {kind: string, user?: any, link?: string, purpose?: string}} */ (null));
  // In the demo workspace, admins manage demo-only people (they sign in only to the demo).
  const demo = isDemoWs.value;
  /** @param {any} u */
  const canManage = (u) => (demo ? u.isSeed : !(u.isDemo || u.isSeed));

  const load = async () => {
    const r = await api('GET', '/users');
    setItems(r.items);
    setEmailOn(r.email);
  };
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((u) => [u.name, u.username, u.email ?? '', t(`roles.${u.role}`)].some((v) => v.toLowerCase().includes(s)));
  }, [items, q]);

  /** @param {any} u @param {() => Promise<any>} fn @param {string} ok */
  async function act(u, fn, ok) {
    try {
      await fn();
      toast('success', ok);
      await load();
    } catch (err) {
      toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
    }
  }

  /** @param {any} u @param {'invite'|'reset'} purpose @param {boolean} send */
  async function link(u, purpose, send) {
    try {
      const r = await api('POST', `/users/${u.id}/${purpose === 'invite' ? 'invite' : 'reset-link'}`, { body: { send } });
      if (r.emailed) toast('success', t('admin.linkEmailed', { email: u.email }));
      else setDialog({ kind: 'link', user: u, link: r.link, purpose });
    } catch (err) {
      toast('danger', err instanceof ApiError ? err.text : t('errors.generic'));
    }
  }

  /** @param {any} u */
  async function toggleStatus(u) {
    const disabling = u.status === 'active';
    if (disabling) {
      const ok = await confirm({ title: t('admin.disableTitle', { name: u.name }), message: t('admin.disableText'), confirmLabel: t('admin.disable'), danger: true });
      if (!ok) return;
    }
    act(u, () => api('PATCH', `/users/${u.id}`, { body: { status: disabling ? 'disabled' : 'active' }, version: u.version }),
      disabling ? t('admin.userDisabled') : t('admin.userEnabled'));
  }

  /** @param {any} u */
  async function removePasskeys(u) {
    const ok = await confirm({ title: t('admin.removePasskeysTitle'), message: t('admin.removePasskeysText', { name: u.name }), danger: true, confirmLabel: t('common.remove') });
    if (ok) act(u, () => api('DELETE', `/users/${u.id}/passkeys`), t('admin.passkeysRemoved'));
  }

  /** @param {any} u */
  async function revokeSessions(u) {
    const ok = await confirm({ title: t('admin.revokeSessionsTitle'), message: t('admin.revokeSessionsText', { name: u.name }), danger: true, confirmLabel: t('admin.revokeSessions') });
    if (ok) act(u, () => api('DELETE', `/users/${u.id}/sessions`), t('admin.sessionsRevoked'));
  }

  /** @param {any} u */
  async function transferRoot(u) {
    const ok = await confirm({ title: t('admin.transferRootTitle'), message: t('admin.transferRootText', { name: u.name }), confirmLabel: t('admin.transferRoot'), typeToConfirm: u.username });
    if (ok) act(u, () => api('POST', `/users/${u.id}/transfer-root`, { body: {} }), t('admin.rootTransferred'));
  }

  /** @param {any} u */
  async function exportData(u) {
    const r = await api('GET', `/users/${u.id}/export`);
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `export-${u.username}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const columns = [
    {
      key: 'name', label: t('admin.colUser'), primary: true, sort: (/** @type {any} */ u) => u.name.toLowerCase(),
      render: (/** @type {any} */ u) => html`<div class="cluster nowrap" style=${{ '--cluster-gap': 'var(--space-3)', flexWrap: 'nowrap' }}>
        <${Avatar} name=${u.name} color=${u.color} initials=${u.initials} />
        <div class="grow"><div class="cell-strong truncate">${u.name} ${u.isRoot && html`<${Badge} tone="accent" icon="star">${t('admin.root')}</${Badge}>`}</div>
          <div class="xs muted truncate">@${u.username}</div></div>
      </div>`,
    },
    { key: 'email', label: t('account.email'), sort: (/** @type {any} */ u) => u.email ?? '', render: (/** @type {any} */ u) => u.email ?? '—' },
    { key: 'role', label: t('admin.colRole'), sort: (/** @type {any} */ u) => ROLES.indexOf(u.role), render: (/** @type {any} */ u) => html`<${Badge} tone=${u.role === 'admin' ? 'accent' : u.role === 'moderator' ? 'info' : 'neutral'}>${t(`roles.${u.role}`)}</${Badge}>` },
    { key: 'status', label: t('admin.colStatus'), sort: (/** @type {any} */ u) => u.status, render: (/** @type {any} */ u) => html`<${Badge} tone=${{ active: 'success', invited: 'warning', disabled: 'neutral' }[u.status]}>${t(`admin.status_${u.status}`)}</${Badge}>` },
    { key: 'passkeys', label: t('admin.colPasskeys'), sort: (/** @type {any} */ u) => u.passkeys, render: (/** @type {any} */ u) => html`<span class="num">${u.passkeys}</span>` },
    { key: 'upcoming', label: t('admin.colUpcoming'), sort: (/** @type {any} */ u) => u.upcoming, render: (/** @type {any} */ u) => html`<span class="num">${u.upcoming}</span>` },
    { key: 'lastLoginAt', label: t('admin.colLastLogin'), class: 'cell-nowrap', sort: (/** @type {any} */ u) => u.lastLoginAt ?? '', render: (/** @type {any} */ u) => (u.lastLoginAt ? fmtInstant(u.lastLoginAt) : html`${t('common.never')}${u.legacyPassword ? html` <${Badge} tone="warning">${t('admin.legacyPassword')}</${Badge}>` : ''}`) },
    { key: 'createdAt', label: t('admin.colCreated'), class: 'cell-nowrap', sort: (/** @type {any} */ u) => u.createdAt, render: (/** @type {any} */ u) => fmtDate(u.createdAt.slice(0, 10)) },
    {
      key: 'actions', label: t('common.actions'), actions: true,
      render: (/** @type {any} */ u) => html`<div class="cluster" style=${{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
        <${Button} size="sm" icon="pencil" onClick=${() => setDialog({ kind: 'edit', user: u })} disabled=${!canManage(u)}
          title=${canManage(u) ? undefined : t('admin.demoLockedHint')}>${t('common.edit')}</${Button}>
        <${Popover} align="end" label=${t('common.moreActions')} trigger=${(/** @type {any} */ p) => html`<button type="button" class="btn btn--ghost btn--icon btn--sm"
          ref=${p.ref} onClick=${p.toggle} aria-expanded=${p['aria-expanded']} aria-haspopup="menu" aria-label=${t('common.moreActionsFor', { name: u.name })}
          disabled=${!canManage(u)}><${Icon} name="ellipsis" /></button>`}>
          ${(/** @type {() => void} */ close) => html`<div class="menu" role="menu" onKeyDown=${menuKeys}>
            ${u.status === 'invited' && html`
              ${emailOn && u.email && html`<${MenuItem} icon="send" onClick=${() => (close(), link(u, 'invite', true))}>${t('admin.resendInvite')}</${MenuItem}>`}
              <${MenuItem} icon="link" onClick=${() => (close(), link(u, 'invite', false))}>${t('admin.copyInviteLink')}</${MenuItem}>`}
            ${u.status === 'active' && html`
              ${emailOn && u.email && html`<${MenuItem} icon="mail" onClick=${() => (close(), link(u, 'reset', true))}>${t('admin.sendResetLink')}</${MenuItem}>`}
              <${MenuItem} icon="link" onClick=${() => (close(), link(u, 'reset', false))}>${t('admin.copyResetLink')}</${MenuItem}>`}
            <${MenuItem} icon="key-round" onClick=${() => (close(), removePasskeys(u))}>${t('admin.removePasskeys')}</${MenuItem}>
            <${MenuItem} icon="log-out" onClick=${() => (close(), revokeSessions(u))}>${t('admin.revokeSessions')}</${MenuItem}>
            <${MenuItem} icon="download" onClick=${() => (close(), exportData(u))}>${t('admin.exportData')}</${MenuItem}>
            ${!demo && me.value?.isRoot && u.role === 'admin' && u.status === 'active' && !u.isRoot &&
            html`<${MenuItem} icon="star" onClick=${() => (close(), transferRoot(u))}>${t('admin.transferRoot')}</${MenuItem}>`}
            ${!u.isRoot && u.id !== me.value?.id && html`<hr />
              ${u.status !== 'invited' && html`<${MenuItem} icon=${u.status === 'active' ? 'ban' : 'check'} onClick=${() => (close(), toggleStatus(u))}>
                ${u.status === 'active' ? t('admin.disable') : t('admin.enable')}</${MenuItem}>`}
              <${MenuItem} icon="trash-2" danger onClick=${() => (close(), setDialog({ kind: 'delete', user: u }))}>${t('common.delete')}</${MenuItem}>`}
          </div>`}
        </${Popover}>
      </div>`,
    },
  ];

  return html`<div class="stack">
    <div class="page-head">
      <h1>${t('admin.users')}</h1>
      <${Button} variant="primary" icon="user-plus" onClick=${() => setDialog({ kind: 'invite' })}>${demo ? t('admin.addDemoPerson') : t('admin.inviteUser')}</${Button}>
    </div>
    ${demo && html`<${Alert} tone="info" icon="sparkles" title=${t('admin.demoUsersTitle')}>${t('admin.demoUsersText')}</${Alert}>`}
    <${SearchField} value=${q} onInput=${setQ} placeholder=${t('admin.searchUsers')} class="toolbar-search" />
    ${items === null
      ? html`<${SkeletonList} rows=${5} />`
      : html`<${DataTable} caption=${t('admin.users')} columns=${columns} rows=${filtered} initialSort=${{ key: 'name', dir: 1 }}
          empty=${html`<${EmptyState} icon="search" title=${t('common.noResults')} text=${t('common.noResultsText')}
            action=${html`<${Button} onClick=${() => setQ('')}>${t('common.clearSearch')}</${Button}>`} />`} />`}

    ${dialog?.kind === 'invite' && html`<${InviteDialog} emailOn=${emailOn} demo=${demo} onClose=${() => setDialog(null)}
      onDone=${(/** @type {any} */ r) => {
        load();
        if (r.link) setDialog({ kind: 'link', user: r.user, link: r.link, purpose: 'invite' });
        else {
          toast('success', t('admin.inviteSent', { email: r.user.email }));
          setDialog(null);
        }
      }} />`}
    ${dialog?.kind === 'edit' && html`<${EditDialog} user=${dialog.user} demo=${demo} onClose=${() => setDialog(null)} onDone=${() => (setDialog(null), load())} />`}
    ${dialog?.kind === 'delete' && html`<${DeleteDialog} user=${dialog.user} users=${items ?? []} onClose=${() => setDialog(null)}
      onDone=${() => (setDialog(null), toast('success', t('admin.userDeleted')), load())} />`}
    ${dialog?.kind === 'link' && html`<${LinkDialog} user=${dialog.user} link=${dialog.link} purpose=${dialog.purpose} onClose=${() => setDialog(null)} />`}
  </div>`;
}

/** @param {{emailOn: boolean, demo?: boolean, onClose: () => void, onDone: (r: any) => void}} p */
function InviteDialog({ emailOn, demo, onClose, onDone }) {
  const [f, setF] = useState({ name: '', username: '', email: '', role: 'user' });
  const [errors, setErrors] = useState(/** @type {Record<string,string>} */ ({}));
  const [busy, setBusy] = useState(false);
  const [touchedUsername, setTouchedUsername] = useState(false);
  /** @param {string} k @param {string} v */
  const set = (k, v) => {
    const next = { ...f, [k]: v };
    // Suggest a username from the name until the admin edits it.
    if (k === 'name' && !touchedUsername) next.username = suggestUsername(v);
    if (k === 'username') setTouchedUsername(true);
    setF(next);
  };

  /** @param {Event} e */
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const body = { ...f, name: f.name.trim(), username: f.username.trim(), email: f.email.trim() };
      onDone(await api('POST', '/users', { body }));
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(fieldErrors(err));
        if (!Object.keys(err.fields).length) toast('danger', err.text);
      }
    } finally {
      setBusy(false);
    }
  }

  return html`<${Modal} open onClose=${onClose} title=${demo ? t('admin.addDemoPerson') : t('admin.inviteUser')}
    footer=${html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
      <${Button} variant="primary" type="submit" form="invite-form" busy=${busy} icon=${demo ? 'user-plus' : 'send'}>${demo ? t('admin.addDemoPerson') : t('admin.sendInvite')}</${Button}>`}>
    <form id="invite-form" class="stack" onSubmit=${submit} noValidate>
      <p class="muted small">${demo ? t('admin.inviteIntroDemo') : emailOn ? t('admin.inviteIntroEmail') : t('admin.inviteIntroNoEmail')}</p>
      <${Field} label=${t('account.name')} error=${errors.name} required>${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f.name} onInput=${(/** @type {string} */ v) => set('name', v)} autocomplete="off" />`}</${Field}>
      <${Field} label=${t('auth.username')} error=${errors.username} hint=${t('admin.usernameHint')} required>${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f.username} onInput=${(/** @type {string} */ v) => set('username', v.toLowerCase())} autocapitalize="none" spellcheck="false" />`}</${Field}>
      <${Field} label=${t('account.email')} error=${errors.email} required=${!demo}>${(/** @type {any} */ a) => html`<${Input} ...${a} type="email" value=${f.email} onInput=${(/** @type {string} */ v) => set('email', v)} />`}</${Field}>
      <${Field} label=${t('admin.colRole')}>${(/** @type {any} */ a) => html`<${Select} ...${a} value=${f.role} onChange=${(/** @type {string} */ v) => set('role', v)}
        options=${ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))} />`}</${Field}>
    </form>
  </${Modal}>`;
}

/** @param {{user: any, demo?: boolean, onClose: () => void, onDone: () => void}} p */
function EditDialog({ user: u, demo, onClose, onDone }) {
  const [f, setF] = useState({ name: u.name, username: u.username, email: u.email ?? '', role: u.role, color: u.color, initials: u.initials ?? '' });
  const [errors, setErrors] = useState(/** @type {Record<string,string>} */ ({}));
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(u.version);
  /** @param {string} k @param {string} v */
  const set = (k, v) => setF({ ...f, [k]: v });

  /** @param {Event} e */
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      /** @type {Record<string, any>} */
      const body = { name: f.name.trim(), role: f.role, color: f.color, initials: f.initials.trim() || null };
      body.email = f.email.trim() || null;
      if (!u.isRoot && !demo) body.username = f.username.trim();
      await api('PATCH', `/users/${u.id}`, { body, version });
      toast('success', t('common.saved'));
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        // Keep what was typed; refresh the version.
        toast('warning', t('errors.version_conflict'));
        const fresh = await api('GET', `/users/${u.id}`);
        setVersion(fresh.version);
      } else if (err instanceof ApiError) {
        setErrors(fieldErrors(err));
        if (!Object.keys(err.fields).length) toast('danger', err.text);
      }
    } finally {
      setBusy(false);
    }
  }

  return html`<${Modal} open onClose=${onClose} title=${t('admin.editUser', { name: u.name })}
    footer=${html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
      <${Button} variant="primary" type="submit" form="edit-user-form" busy=${busy}>${t('common.save')}</${Button}>`}>
    <form id="edit-user-form" class="stack" onSubmit=${submit} noValidate>
      <div class="cluster" style=${{ '--cluster-gap': 'var(--space-3)' }}>
        <${Avatar} name=${f.name} color=${f.color} initials=${f.initials} size="lg" />
        <span class="muted small">${t('admin.avatarPreview')}</span>
      </div>
      <${Field} label=${t('account.name')} error=${errors.name} required>${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f.name} onInput=${(/** @type {string} */ v) => set('name', v)} />`}</${Field}>
      <div class="field-row">
        <${Field} label=${t('auth.username')} error=${errors.username} hint=${demo ? t('admin.demoUsernameLocked') : u.isRoot ? t('admin.rootUsernameLocked') : t('admin.usernameRenameHint')}>
          ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f.username} disabled=${u.isRoot || demo} onInput=${(/** @type {string} */ v) => set('username', v.toLowerCase())} autocapitalize="none" />`}</${Field}>
        <${Field} label=${t('admin.initials')} error=${errors.initials} hint=${t('admin.initialsHint')}>
          ${(/** @type {any} */ a) => html`<${Input} ...${a} value=${f.initials} maxLength="3" onInput=${(/** @type {string} */ v) => set('initials', v.toUpperCase())} />`}</${Field}>
      </div>
      <${Field} label=${t('account.email')} error=${errors.email}>${(/** @type {any} */ a) => html`<${Input} ...${a} type="email" value=${f.email} onInput=${(/** @type {string} */ v) => set('email', v)} />`}</${Field}>
      <${Field} label=${t('admin.colRole')} error=${errors.role} hint=${u.isRoot ? t('admin.rootRoleLocked') : t('admin.roleChangeHint')}>
        ${(/** @type {any} */ a) => html`<${Select} ...${a} value=${f.role} disabled=${u.isRoot} onChange=${(/** @type {string} */ v) => set('role', v)}
          options=${ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))} />`}</${Field}>
      <div class="field"><span class="field-label">${t('admin.color')}</span>
        <${ColorPicker} value=${f.color} onChange=${(/** @type {string} */ v) => set('color', v)} legend=${t('admin.color')} /></div>
    </form>
  </${Modal}>`;
}

/** @param {{user: any, users: any[], onClose: () => void, onDone: () => void}} p */
function DeleteDialog({ user: u, users, onClose, onDone }) {
  const [to, setTo] = useState('');
  const [keepPast, setKeepPast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const needsTransfer = u.upcoming > 0;
  const targets = users.filter((x) => x.id !== u.id && x.status === 'active');

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', `/users/${u.id}`, { body: { transferTo: to || null, keepPast: to ? keepPast : undefined }, version: u.version });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.text : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  return html`<${Modal} open onClose=${onClose} title=${t('admin.deleteUserTitle', { name: u.name })}
    footer=${html`<${Button} onClick=${onClose}>${t('common.cancel')}</${Button}>
      <${Button} variant="danger" busy=${busy} disabled=${needsTransfer && !to} onClick=${submit}>${t('admin.deleteUser')}</${Button}>`}>
    <div class="stack">
      ${error && html`<${Alert} tone="danger">${error}</${Alert}>`}
      ${needsTransfer
        ? html`<${Alert} tone="warning">${t('admin.deleteHasUpcoming', { n: u.upcoming })}</${Alert}>`
        : html`<p>${t('admin.deleteText')}</p>`}
      <${Field} label=${t('admin.transferTo')} hint=${needsTransfer ? t('admin.transferRequired') : t('admin.transferOptional')} required=${needsTransfer}>
        ${(/** @type {any} */ a) => html`<${Select} ...${a} value=${to} onChange=${setTo} placeholder=${needsTransfer ? t('admin.chooseUser') : t('admin.noTransfer')}
          options=${targets.map((x) => ({ value: x.id, label: `${x.name} (@${x.username})` }))} />`}
      </${Field}>
      ${to && html`<${Checkbox} checked=${keepPast} onChange=${setKeepPast} label=${t('admin.keepPast')} />`}
      <p class="small muted">${t('admin.formerUserNote')}</p>
    </div>
  </${Modal}>`;
}

/** @param {{user: any, link: string, purpose: string, onClose: () => void}} p */
function LinkDialog({ user: u, link, purpose, onClose }) {
  return html`<${Modal} open onClose=${onClose} title=${purpose === 'invite' ? t('admin.inviteLinkTitle') : t('admin.resetLinkTitle')}
    footer=${html`<${Button} onClick=${onClose}>${t('common.close')}</${Button}>
      <${Button} variant="primary" icon="copy" onClick=${() => copyText(link, t('admin.linkCopied'))}>${t('admin.copyLink')}</${Button}>`}>
    <div class="stack">
      <p>${purpose === 'invite' ? t('admin.inviteLinkText', { name: u.name }) : t('admin.resetLinkText', { name: u.name })}</p>
      <input class="input" readOnly value=${link} aria-label=${t('admin.copyLink')} onFocus=${(/** @type {any} */ e) => e.currentTarget.select()} />
      <p class="small muted">${purpose === 'invite' ? t('admin.inviteValidity') : t('admin.resetValidity')}</p>
    </div>
  </${Modal}>`;
}

/** @param {ApiError} err */
function fieldErrors(err) {
  return Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, t(`errors.${v}`)]));
}

/** "Anca Popescu" → "anca.popescu" @param {string} name */
function suggestUsername(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 32);
}
