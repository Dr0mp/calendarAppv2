import { signal } from '@preact/signals';
import { html, useEffect, useLayoutEffect, useRef, useState } from '../html.js';
import { t } from '../i18n/index.js';
import { Button, Icon, IconButton, RadioGroup } from './ui.js';
import { isCompact } from './media-query.js';

/**
 * Native <dialog> as a modal: the browser traps focus; we return focus to the
 * opener on close. Escape and backdrop clicks call onClose.
 * @param {{open: boolean, onClose: () => void, title: any, children?: any, footer?: any, kind?: 'dialog'|'sheet'|'panel',
 *   size?: 'md'|'lg'|'xl'|'wide'|'full', class?: string, labelledBy?: string, headerExtra?: any, dismissible?: boolean}} p
 */
export function Modal({ open, onClose, title, children, footer, kind = 'dialog', size = 'md', class: cls = '', headerExtra, dismissible = true }) {
  const ref = useRef(/** @type {HTMLDialogElement|null} */ (null));
  const opener = useRef(/** @type {Element|null} */ (null));
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2)}`);

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
      const focusable = /** @type {HTMLElement|null} */ (d.querySelector('[autofocus], .dialog-body input, .dialog-body select, .dialog-body textarea'));
      (focusable ?? d.querySelector('.dialog-head button') ?? d)?.focus?.();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onClosed = () => {
      const o = /** @type {HTMLElement|null} */ (opener.current);
      if (o && document.contains(o)) o.focus?.();
    };
    d.addEventListener('close', onClosed);
    return () => d.removeEventListener('close', onClosed);
  }, []);

  // Sheets: drag the handle down to dismiss.
  const drag = useRef({ y: 0, active: false });
  /** @param {PointerEvent} e */
  const onHandleDown = (e) => {
    drag.current = { y: e.clientY, active: true };
    /** @type {HTMLElement} */ (e.currentTarget).setPointerCapture(e.pointerId);
  };
  /** @param {PointerEvent} e */
  const onHandleMove = (e) => {
    if (!drag.current.active || !ref.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    ref.current.style.setProperty('transform', `translateY(${dy}px)`);
    ref.current.style.setProperty('transition', 'none');
  };
  /** @param {PointerEvent} e */
  const onHandleUp = (e) => {
    if (!drag.current.active || !ref.current) return;
    drag.current.active = false;
    const dy = e.clientY - drag.current.y;
    ref.current.style.removeProperty('transform');
    ref.current.style.removeProperty('transition');
    if (dy > 90 && dismissible) onClose();
  };

  const classes = {
    dialog: `dialog ${size === 'lg' ? 'dialog--lg' : size === 'xl' ? 'dialog--xl' : ''}`,
    sheet: `sheet ${size === 'full' ? 'sheet--full' : ''}`,
    panel: `panel ${size === 'wide' ? 'panel--wide' : ''}`,
  }[kind];

  return html`<dialog ref=${ref} class=${`${classes} ${cls}`} aria-labelledby=${titleId.current}
    onCancel=${(/** @type {Event} */ e) => {
      e.preventDefault();
      if (dismissible) onClose();
    }}
    onClick=${(/** @type {MouseEvent} */ e) => {
      if (e.target === ref.current && dismissible) onClose();
    }}>
    ${open && html`
      ${kind === 'sheet' && size !== 'full' && html`<div class="sheet-handle" onPointerDown=${onHandleDown} onPointerMove=${onHandleMove}
        onPointerUp=${onHandleUp} onPointerCancel=${onHandleUp} aria-hidden="true"></div>`}
      <div class="dialog-head">
        <h2 id=${titleId.current}>${title}</h2>
        ${headerExtra}
        ${dismissible && html`<${IconButton} icon="x" label=${t('common.close')} onClick=${onClose} />`}
      </div>
      <div class="dialog-body">${children}</div>
      ${footer && html`<div class="dialog-foot">${footer}</div>`}
    `}
  </dialog>`;
}

/**
 * Responsive container: side panel on desktop, sheet on phones.
 * @param {Parameters<typeof Modal>[0] & {phone?: 'sheet'|'full'}} p
 */
export function Overlay(p) {
  const compact = isCompact.value;
  return html`<${Modal} ...${p} kind=${compact ? 'sheet' : 'panel'} size=${compact ? (p.phone === 'full' ? 'full' : 'md') : p.size} />`;
}

// ---- Imperative confirm dialog --------------------------------------------

/**
 * @typedef {{title: string, message?: any, confirmLabel?: string, cancelLabel?: string, danger?: boolean,
 *   typeToConfirm?: string, choices?: {value: string, label: any, hint?: any}[], defaultChoice?: string,
 *   input?: {label: string, value?: string, max?: number}}} ConfirmOpts
 */

/** @type {import('@preact/signals').Signal<(ConfirmOpts & {resolve: (v: any) => void})|null>} */
const confirmState = signal(null);

/**
 * Ask for confirmation. Resolves true/false, the chosen value when `choices`
 * are given, or the typed text with `input` (null on Cancel). Cancel always aborts.
 * @param {ConfirmOpts} opts
 * @returns {Promise<any>}
 */
export function confirm(opts) {
  return new Promise((resolve) => {
    confirmState.value = { ...opts, resolve };
  });
}

export function ConfirmHost() {
  const s = confirmState.value;
  const [choice, setChoice] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => {
    setChoice(s?.defaultChoice ?? s?.choices?.[0]?.value ?? '');
    setTyped(s?.input?.value ?? '');
  }, [s]);
  const valued = !!(s?.choices || s?.input);
  /** @param {any} v */
  const done = (v) => {
    s?.resolve(v);
    confirmState.value = null;
  };
  const blocked = (!!s?.typeToConfirm && typed.trim() !== s.typeToConfirm) || (!!s?.input && !typed.trim());
  const result = () => (s?.input ? typed.trim() : s?.choices ? choice : true);
  return html`<${Modal} open=${!!s} onClose=${() => done(valued ? null : false)} title=${s?.title ?? ''}
    footer=${s && html`
      <${Button} onClick=${() => done(valued ? null : false)}>${s.cancelLabel ?? t('common.cancel')}</${Button}>
      <${Button} variant=${s.danger ? 'danger' : 'primary'} disabled=${blocked || (s.choices && !choice)}
        onClick=${() => done(result())}>${s.confirmLabel ?? t('common.confirm')}</${Button}>`}>
    ${s && html`<div class="stack">
      ${s.message && html`<div class="pre-line">${s.message}</div>`}
      ${s.choices && html`<${RadioGroup} legend=${t('common.chooseScope')} name="confirm-choice" value=${choice} onChange=${setChoice}
        options=${s.choices} />`}
      ${s.input && html`<div class="field">
        <label for="confirm-input">${s.input.label}</label>
        <input id="confirm-input" class="input" value=${typed} maxLength=${s.input.max} autofocus
          onInput=${(/** @type {any} */ e) => setTyped(e.currentTarget.value)}
          onKeyDown=${(/** @type {KeyboardEvent} */ e) => e.key === 'Enter' && typed.trim() && done(result())} />
      </div>`}
      ${s.typeToConfirm && html`<div class="field">
        <label for="confirm-type">${t('common.typeToConfirm', { text: s.typeToConfirm })}</label>
        <input id="confirm-type" class="input" value=${typed} onInput=${(/** @type {any} */ e) => setTyped(e.currentTarget.value)} autocomplete="off" />
      </div>`}
    </div>`}
  </${Modal}>`;
}

// ---- Popover / menu --------------------------------------------------------

/**
 * A popover anchored to a trigger. Closes on outside click and Escape.
 * @param {{trigger: (p: {open: boolean, toggle: () => void, ref: any, 'aria-expanded': string, 'aria-haspopup': string}) => any,
 *   children: (close: () => void) => any, align?: 'start'|'end', label?: string, class?: string}} p
 */
export function Popover({ trigger, children, align = 'start', label, class: cls = '' }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(/** @type {HTMLElement|null} */ (null));
  const pop = useRef(/** @type {HTMLDivElement|null} */ (null));
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return;
    const r = btn.current.getBoundingClientRect();
    const pw = pop.current.offsetWidth;
    const ph = pop.current.offsetHeight;
    let left = align === 'end' ? r.right - pw : r.left;
    left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 12 && r.top - ph - 6 > 12) top = r.top - ph - 6;
    setPos({ top, left });
    const first = /** @type {HTMLElement|null} */ (pop.current.querySelector('button, a, input, select, [tabindex="0"]'));
    first?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    /** @param {MouseEvent} e */
    const onDoc = (e) => {
      const tgt = /** @type {Node} */ (e.target);
      if (!pop.current?.contains(tgt) && !btn.current?.contains(tgt)) setOpen(false);
    };
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const openedAt = performance.now();
    const onScroll = (/** @type {Event} */ e) => {
      if (performance.now() - openedAt < 150) return;
      if (!pop.current?.contains(/** @type {Node} */ (e.target))) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  return html`${trigger({ open, toggle: () => setOpen(!open), ref: btn, 'aria-expanded': open ? 'true' : 'false', 'aria-haspopup': 'true' })}
    ${open && html`<div class=${`popover ${cls}`} ref=${pop} role="dialog" aria-label=${label} style=${{ top: `${pos.top}px`, left: `${pos.left}px` }}>
      ${children(close)}
    </div>`}`;
}

/** Arrow-key navigation inside a .menu. @param {KeyboardEvent} e */
export function menuKeys(e) {
  if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const items = [.../** @type {HTMLElement} */ (e.currentTarget).querySelectorAll('.menu-item')];
  const i = items.indexOf(/** @type {any} */ (document.activeElement));
  const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
  /** @type {HTMLElement} */ (next)?.focus();
}

/** @param {{icon?: string, children: any, onClick?: () => void, href?: string, danger?: boolean, end?: any}} p */
export function MenuItem({ icon, children, onClick, href, danger, end }) {
  const cls = `menu-item ${danger ? 'menu-item--danger' : ''}`;
  const inner = html`${icon && html`<${Icon} name=${icon} />`}<span>${children}</span>${end && html`<span class="menu-end">${end}</span>`}`;
  if (href) return html`<a class=${cls} href=${href} role="menuitem" onClick=${onClick}>${inner}</a>`;
  return html`<button type="button" class=${cls} role="menuitem" onClick=${onClick}>${inner}</button>`;
}
