import { html, useEffect, useId, useRef, useState } from '../html.js';
import { t } from '../i18n/index.js';
import { passwordStrength } from '/shared/rules/password.js';

/** @param {{name: string, class?: string, label?: string}} p */
export function Icon({ name, class: cls = '', label }) {
  return html`<svg class=${`icon ${cls}`} aria-hidden=${label ? undefined : 'true'} role=${label ? 'img' : undefined} aria-label=${label}>
    <use href=${`/icons.svg#i-${name}`}></use>
  </svg>`;
}

/**
 * @param {{variant?: 'primary'|'secondary'|'ghost'|'danger'|'danger-ghost', size?: 'sm'|'md'|'lg', icon?: string,
 *   iconEnd?: string, busy?: boolean, block?: boolean, href?: string, children?: any, class?: string, [k: string]: any}} p
 */
export function Button({ variant = 'secondary', size = 'md', icon, iconEnd, busy, block, href, children, class: cls = '', ...rest }) {
  const classes = ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', cls].filter(Boolean).join(' ');
  const content = html`${icon && html`<${Icon} name=${icon} />`}${children}${iconEnd && html`<${Icon} name=${iconEnd} />`}`;
  if (href) return html`<a class=${classes} href=${href} ...${rest}>${content}</a>`;
  return html`<button type="button" class=${classes} aria-busy=${busy ? 'true' : undefined} disabled=${rest.disabled} ...${rest}>${content}</button>`;
}

/** Icon-only button; `label` is required for screen readers. @param {{icon: string, label: string, variant?: string, size?: string, [k: string]: any}} p */
export function IconButton({ icon, label, variant = 'ghost', size = 'md', class: cls = '', ...rest }) {
  return html`<button type="button" class=${`btn btn--${variant} btn--icon ${size === 'sm' ? 'btn--sm' : ''} ${cls}`} aria-label=${label} title=${label} ...${rest}>
    <${Icon} name=${icon} />
  </button>`;
}

/** @param {{tone?: string, icon?: string, children?: any, class?: string, title?: string}} p */
export function Badge({ tone = 'neutral', icon, children, class: cls = '', title }) {
  return html`<span class=${`badge ${tone !== 'neutral' ? `badge--${tone}` : ''} ${cls}`} title=${title}>${icon && html`<${Icon} name=${icon} />`}${children}</span>`;
}

/** @param {{name: string, color?: string, initials?: string, size?: 'sm'|'md'|'lg'}} p */
export function Avatar({ name, color = 'owner-7', initials, size = 'md' }) {
  const text = initials || initialsOf(name);
  return html`<span class=${`avatar ${size !== 'md' ? `avatar--${size}` : ''}`} style=${{ '--av': `var(--${color})` }} aria-hidden="true">${text}</span>`;
}

/** @param {string} name */
export function initialsOf(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = [...parts[0]][0] ?? '';
  const b = parts.length > 1 ? [...parts[parts.length - 1]][0] ?? '' : [...parts[0]][1] ?? '';
  return (a + b).toUpperCase();
}

/** @param {{name: string, color?: string, initials?: string}} p */
export function OwnerInline({ name, color, initials }) {
  return html`<span class="owner-inline"><${Avatar} name=${name} color=${color} initials=${initials} size="sm" /><span>${name}</span></span>`;
}

/** One sentence of explanation and one primary action. @param {{icon?: string, title: string, text?: string, action?: any}} p */
export function EmptyState({ icon = 'calendar', title, text, action }) {
  return html`<div class="empty">
    <div class="empty-icon"><${Icon} name=${icon} /></div>
    <h2>${title}</h2>
    ${text && html`<p>${text}</p>`}
    ${action}
  </div>`;
}

/** @param {{w?: string, h?: string, class?: string}} p */
export function Skeleton({ w = '100%', h = '16px', class: cls = '' }) {
  return html`<span class=${`skeleton ${cls}`} style=${{ '--sk-w': w, '--sk-h': h }} aria-hidden="true"></span>`;
}

/** @param {{rows?: number}} p */
export function SkeletonList({ rows = 4 }) {
  return html`<div class="stack" role="status" aria-label=${t('common.loading')}>
    ${Array.from({ length: rows }, () => html`<${Skeleton} h="64px" />`)}
  </div>`;
}

export function Spinner() {
  return html`<div class="spinner" role="status" aria-label=${t('common.loading')}></div>`;
}

/** @param {{value: number, label?: string}} p value 0..1 */
export function Progress({ value, label }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return html`<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${pct} aria-label=${label}>
    <span style=${{ '--value': `${pct}%` }}></span>
  </div>`;
}

/** @param {{value: number, label: string, level?: string|null}} p value 0..1 */
export function Meter({ value, label, level }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10;
  return html`<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${pct} aria-label=${label}
    data-level=${level === 'full' ? 'critical' : level ?? undefined}>
    <span style=${{ '--value': `${Math.min(pct, 100)}%` }}></span>
  </div>`;
}

/** @param {{tone?: 'info'|'warning'|'danger'|'success', title?: string, children?: any, icon?: string, class?: string, role?: string}} p */
export function Alert({ tone = 'info', title, children, icon, class: cls = '', role }) {
  const ic = icon ?? { info: 'info', warning: 'triangle-alert', danger: 'circle-alert', success: 'circle-check' }[tone];
  return html`<div class=${`alert alert--${tone} ${cls}`} role=${role ?? (tone === 'danger' ? 'alert' : undefined)}>
    <${Icon} name=${ic} />
    <div class="alert-body">${title && html`<strong>${title}</strong>`}${children}</div>
  </div>`;
}

/**
 * Segmented control (radio-group semantics). Used for view switches and entry type.
 * @param {{options: {value: string, label: any, icon?: string, disabled?: boolean}[], value: string,
 *   onChange: (v: string) => void, label: string, block?: boolean, wrap?: boolean, size?: string}} p
 */
export function Segmented({ options, value, onChange, label, block, wrap }) {
  const ref = useRef(/** @type {HTMLDivElement|null} */ (null));
  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    let i = enabled.findIndex((o) => o.value === value);
    if (e.key === 'ArrowRight') i = (i + 1) % enabled.length;
    if (e.key === 'ArrowLeft') i = (i - 1 + enabled.length) % enabled.length;
    if (e.key === 'Home') i = 0;
    if (e.key === 'End') i = enabled.length - 1;
    onChange(enabled[i].value);
    requestAnimationFrame(() => ref.current?.querySelector(`[aria-checked="true"]`)?.focus());
  }
  return html`<div class=${`segmented ${block ? 'segmented--block' : ''} ${wrap ? 'segmented--wrap' : ''}`} role="radiogroup" aria-label=${label} ref=${ref} onKeyDown=${onKey}>
    ${options.map(
      (o) => html`<button type="button" role="radio" aria-checked=${o.value === value ? 'true' : 'false'} tabindex=${o.value === value ? 0 : -1}
        disabled=${o.disabled} onClick=${() => onChange(o.value)} data-value=${o.value}>
        ${o.icon && html`<${Icon} name=${o.icon} />`}${o.label}
      </button>`,
    )}
  </div>`;
}

/**
 * Tabs with optional counts. Links (href) or buttons (onChange).
 * @param {{items: {value: string, label: any, count?: number|null, href?: string}[], value: string,
 *   onChange?: (v: string) => void, label: string}} p
 */
export function Tabs({ items, value, onChange, label }) {
  const ref = useRef(/** @type {HTMLDivElement|null} */ (null));
  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (!onChange || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const i = items.findIndex((x) => x.value === value);
    const next = items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector('[aria-selected="true"]')?.focus());
  }
  if (items.some((i) => i.href)) {
    return html`<nav class="tabs" aria-label=${label}>
      ${items.map(
        (i) => html`<a href=${i.href} aria-current=${i.value === value ? 'page' : undefined}>${i.label}
          ${i.count != null && html`<span class="count">${i.count}</span>`}</a>`,
      )}
    </nav>`;
  }
  return html`<div class="tabs" role="tablist" aria-label=${label} ref=${ref} onKeyDown=${onKey}>
    ${items.map(
      (i) => html`<button type="button" role="tab" aria-selected=${i.value === value ? 'true' : 'false'} tabindex=${i.value === value ? 0 : -1}
        onClick=${() => onChange?.(i.value)}>${i.label}${i.count != null && html`<span class="count">${i.count}</span>`}</button>`,
    )}
  </div>`;
}

/**
 * Field wrapper: label, hint, error, required marker, counter.
 * `children` is a function receiving the control's props (id, aria-*).
 * @param {{label: any, hint?: any, error?: string|null, required?: boolean, counter?: {n: number, max: number, warnAt?: number|null},
 *   children: (a: {id: string, 'aria-describedby'?: string, 'aria-invalid'?: string, required?: boolean}) => any, class?: string, id?: string}} p
 */
export function Field({ label, hint, error, required, counter, children, class: cls = '', id: forcedId }) {
  const auto = useId();
  const id = forcedId ?? `f${auto}`;
  const hintId = hint ? `${id}-hint` : '';
  const errId = error ? `${id}-err` : '';
  const describedby = [hintId, errId].filter(Boolean).join(' ') || undefined;
  const state = counter ? (counter.n > counter.max ? 'over' : counter.warnAt && counter.n > counter.warnAt ? 'warn' : '') : '';
  return html`<div class=${`field ${cls}`} data-invalid=${error ? 'true' : undefined}>
    <label for=${id}>${label}${required && html`<span class="req" aria-hidden="true">*</span>`}
      ${counter && html`<span class="field-counter" data-state=${state} aria-live="polite">${counter.n} / ${counter.max}</span>`}
    </label>
    ${children({ id, 'aria-describedby': describedby, 'aria-invalid': error ? 'true' : undefined, required })}
    ${hint && html`<div class="field-hint" id=${hintId}>${hint}</div>`}
    ${error && html`<div class="field-error" id=${errId}><${Icon} name="circle-alert" />${error}</div>`}
  </div>`;
}

/** Controlled text input. @param {{value: any, onInput: (v: string) => void, [k: string]: any}} p */
export function Input({ value, onInput, class: cls = '', ...rest }) {
  return html`<input class=${`input ${cls}`} value=${value ?? ''} onInput=${(/** @type {any} */ e) => onInput(e.currentTarget.value)} ...${rest} />`;
}

/** @param {{value: any, onInput: (v: string) => void, [k: string]: any}} p */
export function Textarea({ value, onInput, class: cls = '', ...rest }) {
  return html`<textarea class=${`textarea ${cls}`} value=${value ?? ''} onInput=${(/** @type {any} */ e) => onInput(e.currentTarget.value)} ...${rest}></textarea>`;
}

/**
 * Native <select>, styled.
 * @param {{value: any, onChange: (v: string) => void, options: {value: string, label: string, disabled?: boolean}[],
 *   placeholder?: string, [k: string]: any}} p
 */
export function Select({ value, onChange, options, placeholder, class: cls = '', ...rest }) {
  return html`<select class=${`select ${cls}`} value=${value ?? ''} onChange=${(/** @type {any} */ e) => onChange(e.currentTarget.value)} ...${rest}>
    ${placeholder !== undefined && html`<option value="">${placeholder}</option>`}
    ${options.map((o) => html`<option value=${o.value} disabled=${o.disabled} selected=${o.value === value}>${o.label}</option>`)}
  </select>`;
}

/** @param {{checked: boolean, onChange: (v: boolean) => void, label: any, [k: string]: any}} p */
export function Switch({ checked, onChange, label, ...rest }) {
  return html`<label class="switch">
    <input type="checkbox" role="switch" checked=${checked} onChange=${(/** @type {any} */ e) => onChange(e.currentTarget.checked)} ...${rest} />
    <span>${label}</span>
  </label>`;
}

/** @param {{checked: boolean, onChange: (v: boolean) => void, label: any, [k: string]: any}} p */
export function Checkbox({ checked, onChange, label, ...rest }) {
  return html`<label class="check">
    <input type="checkbox" checked=${checked} onChange=${(/** @type {any} */ e) => onChange(e.currentTarget.checked)} ...${rest} />
    <span>${label}</span>
  </label>`;
}

/**
 * @param {{legend: any, name: string, value: string, onChange: (v: string) => void,
 *   options: {value: string, label: any, hint?: any, disabled?: boolean}[]}} p
 */
export function RadioGroup({ legend, name, value, onChange, options }) {
  return html`<fieldset class="radio-group">
    <legend>${legend}</legend>
    ${options.map(
      (o) => html`<label class="radio-card">
        <input type="radio" name=${name} value=${o.value} checked=${o.value === value} disabled=${o.disabled}
          onChange=${() => onChange(o.value)} />
        <span>${o.label}${o.hint && html`<small>${o.hint}</small>`}</span>
      </label>`,
    )}
  </fieldset>`;
}

/** @param {{value: string, onInput: (v: string) => void, placeholder?: string, label?: string, class?: string, [k: string]: any}} p */
export function SearchField({ value, onInput, placeholder, label, class: cls = '', ...rest }) {
  return html`<div class=${`input-group search ${cls}`}>
    <span class="input-lead"><${Icon} name="search" /></span>
    <input class="input" type="search" value=${value} placeholder=${placeholder ?? t('common.search')}
      aria-label=${label ?? placeholder ?? t('common.search')} onInput=${(/** @type {any} */ e) => onInput(e.currentTarget.value)} ...${rest} />
    ${value && html`<span class="input-affix"><${IconButton} icon="x" size="sm" label=${t('common.clear')} onClick=${() => onInput('')} /></span>`}
  </div>`;
}

export const OWNER_COLORS = Array.from({ length: 12 }, (_, i) => `owner-${i + 1}`);

/** 12 accessible preset colours. @param {{value: string, onChange: (v: string) => void, legend: string}} p */
export function ColorPicker({ value, onChange, legend }) {
  const name = `c${useId()}`;
  return html`<fieldset class="swatches">
    <legend class="sr-only">${legend}</legend>
    ${OWNER_COLORS.map(
      (c, i) => html`<label style=${{ '--swatch': `var(--${c})` }} title=${t('common.colorN', { n: i + 1 })}>
        <input type="radio" name=${name} value=${c} checked=${value === c} onChange=${() => onChange(c)} aria-label=${t('common.colorN', { n: i + 1 })} />
      </label>`,
    )}
  </fieldset>`;
}

/**
 * Password input with show/hide, and an optional strength meter.
 * @param {{value: string, onInput: (v: string) => void, meter?: boolean, autocomplete?: string, [k: string]: any}} p
 */
export function PasswordInput({ value, onInput, meter, autocomplete = 'current-password', ...rest }) {
  const [shown, setShown] = useState(false);
  const score = meter ? passwordStrength(value) : 0;
  return html`<div class="stack" style=${{ '--stack-gap': 'var(--space-2)' }}>
    <div class="input-group">
      <input class="input" type=${shown ? 'text' : 'password'} value=${value} autocomplete=${autocomplete} spellcheck="false"
        autocapitalize="off" onInput=${(/** @type {any} */ e) => onInput(e.currentTarget.value)} ...${rest} />
      <span class="input-affix">
        <${IconButton} icon=${shown ? 'eye-off' : 'eye'} size="sm" label=${shown ? t('auth.hidePassword') : t('auth.showPassword')}
          aria-pressed=${shown ? 'true' : 'false'} onClick=${() => setShown(!shown)} />
      </span>
    </div>
    ${meter && value && html`<div class="cluster" style=${{ '--cluster-gap': 'var(--space-3)' }}>
      <div class="strength grow" data-score=${score} aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <span class="xs muted" aria-live="polite">${t(`auth.strength${score}`)}</span>
    </div>`}
  </div>`;
}

/** Autofocus helper: focus the element once mounted. */
export function useAutofocus() {
  const ref = useRef(/** @type {HTMLElement|null} */ (null));
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

/**
 * An image that falls back to a neutral placeholder when it fails to load
 * (offline, expired external link).
 * @param {{src: string, alt?: string, class?: string, icon?: string}} p
 */
export function SafeImg({ src, alt = '', class: cls = '', icon = 'image' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return html`<div class=${`img-fallback ${cls}`} role=${alt ? 'img' : undefined} aria-label=${alt || undefined}><${Icon} name=${icon} /></div>`;
  return html`<img class=${cls} src=${src} alt=${alt} loading="lazy" referrerpolicy="no-referrer" onError=${() => setFailed(true)} />`;
}
