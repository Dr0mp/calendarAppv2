import { html, useState } from '../../html.js';
import { t, locale } from '../../i18n/index.js';
import { setLocale } from '../../state/prefs.js';
import { usePageChrome } from '../../state/chrome.js';
import {
  Alert, Avatar, Badge, Button, Checkbox, ColorPicker, EmptyState, Field, Icon, IconButton, Input, Meter, PasswordInput,
  Progress, RadioGroup, SearchField, Segmented, Select, Skeleton, Switch, Tabs, Textarea,
} from '../../components/ui.js';
import { Modal } from '../../components/overlay.js';
import { DataTable } from '../../components/table.js';
import { toast } from '../../components/toast.js';

const TOKENS = [
  ['surface-0', 'surface-1', 'surface-2', 'surface-3', 'surface-inverse'],
  ['text-strong', 'text-default', 'text-muted', 'text-disabled'],
  ['border-subtle', 'border-default', 'border-strong', 'focus-ring'],
  ['accent', 'accent-hover', 'accent-soft', 'accent-ink'],
  ['success', 'warning', 'danger', 'info'],
  ['success-bg', 'warning-bg', 'danger-bg', 'info-bg'],
  ['type-event', 'type-blocked', 'type-room'],
];

/** Living style guide (admin-only, development). */
export default function Styleguide() {
  usePageChrome(t('styleguide.title'));
  return html`<div class="styleguide">
    <div class="page-head">
      <h1>${t('styleguide.title')}</h1>
      <${Segmented} label=${t('prefs.language')} value=${locale.value} onChange=${(/** @type {any} */ v) => setLocale(v)}
        options=${[{ value: 'ro', label: 'RO' }, { value: 'en', label: 'EN' }]} />
      <p class="page-sub">${t('styleguide.intro')}</p>
    </div>
    <div class="sg-themes">
      <div class="theme-scope sg-theme" data-theme="light"><${Gallery} scope="light" /></div>
      <div class="theme-scope sg-theme" data-theme="dark"><${Gallery} scope="dark" /></div>
    </div>
  </div>`;
}

/** @param {{scope: string}} p */
function Gallery({ scope }) {
  const [seg, setSeg] = useState('month');
  const [tab, setTab] = useState('all');
  const [text, setText] = useState('Sala Mare');
  const [area, setArea] = useState('');
  const [sel, setSel] = useState('a');
  const [sw, setSw] = useState(true);
  const [cb, setCb] = useState(false);
  const [radio, setRadio] = useState('one');
  const [color, setColor] = useState('owner-7');
  const [q, setQ] = useState('');
  const [pw, setPw] = useState('corect horse battery');
  const [open, setOpen] = useState(/** @type {null|'dialog'|'sheet'|'panel'} */ (null));

  return html`<div class="stack sg-gallery" style=${{ '--stack-gap': 'var(--space-8)' }}>
    <section class="stack">
      <h2>${t('styleguide.colors')} · ${scope}</h2>
      ${TOKENS.map(
        (row) => html`<div class="sg-swatches">${row.map(
          (tk) => html`<div class="sg-swatch"><span style=${{ background: `var(--${tk})` }}></span><code>--${tk}</code></div>`,
        )}</div>`,
      )}
      <h3>${t('styleguide.owners')}</h3>
      <div class="sg-swatches">${Array.from({ length: 12 }, (_, i) => html`<div class="sg-owner" style=${{ '--owner': `var(--owner-${i + 1})` }}>
        <span class="sg-owner-chip">${i + 1} · 18:00 Atelier</span></div>`)}</div>
    </section>

    <section class="stack">
      <h2>${t('styleguide.type')}</h2>
      ${['3xl', '2xl', 'xl', 'lg', 'base', 'md', 'sm', 'xs'].map(
        (s) => html`<div style=${{ fontSize: `var(--text-${s})` }}><span class="muted xs">--text-${s}</span> ${t('styleguide.sampleText')}</div>`,
      )}
      <p class="num">0123456789 · 18:00–20:00 · 1.250,00 RON</p>
    </section>

    <section class="stack">
      <h2>${t('styleguide.buttons')}</h2>
      <div class="cluster">
        <${Button} variant="primary">${t('common.save')}</${Button}>
        <${Button}>${t('common.cancel')}</${Button}>
        <${Button} variant="ghost">Ghost</${Button}>
        <${Button} variant="danger" icon="trash-2">${t('common.remove')}</${Button}>
        <${Button} variant="primary" busy>Busy</${Button}>
        <${Button} disabled>Disabled</${Button}>
      </div>
      <div class="cluster">
        <${Button} size="sm" icon="plus">Small</${Button}>
        <${Button} icon="calendar-plus">Medium</${Button}>
        <${Button} size="lg" variant="primary" iconEnd="arrow-right">Large</${Button}>
        <${IconButton} icon="pencil" label=${t('common.rename')} />
        <${IconButton} icon="trash-2" label=${t('common.remove')} variant="secondary" />
      </div>
    </section>

    <section class="stack">
      <h2>${t('styleguide.inputs')}</h2>
      <div class="field-row">
        <${Field} label="Text" hint="Hint" required>${(/** @type {any} */ a) => html`<${Input} ...${a} value=${text} onInput=${setText} />`}</${Field}>
        <${Field} label="Error" error=${t('errors.required')}>${(/** @type {any} */ a) => html`<${Input} ...${a} value="" onInput=${() => {}} />`}</${Field}>
        <${Field} label="Select">${(/** @type {any} */ a) => html`<${Select} ...${a} value=${sel} onChange=${setSel}
          options=${[{ value: 'a', label: 'Sala Mare · 80 locuri' }, { value: 'b', label: 'Studio Video 2B · 15 locuri' }]} />`}</${Field}>
        <${Field} label="Date">${(/** @type {any} */ a) => html`<input class="input" type="date" id=${a.id} value="2026-10-01" />`}</${Field}>
        <${Field} label="Time">${(/** @type {any} */ a) => html`<input class="input" type="time" id=${a.id} value="18:00" step="900" />`}</${Field}>
        <${Field} label="Number">${(/** @type {any} */ a) => html`<input class="input" type="number" id=${a.id} value="80" />`}</${Field}>
        <${Field} label="Disabled">${(/** @type {any} */ a) => html`<${Input} ...${a} value="—" onInput=${() => {}} disabled />`}</${Field}>
        <${Field} label=${t('auth.password')}>${(/** @type {any} */ a) => html`<${PasswordInput} ...${a} value=${pw} onInput=${setPw} meter />`}</${Field}>
      </div>
      <${Field} label="Textarea" counter=${{ n: area.length, max: 40, warnAt: 20 }}>${(/** @type {any} */ a) => html`<${Textarea} ...${a} value=${area} onInput=${setArea} />`}</${Field}>
      <${SearchField} value=${q} onInput=${setQ} />
      <div class="cluster" style=${{ '--cluster-gap': 'var(--space-6)' }}>
        <${Switch} checked=${sw} onChange=${setSw} label="Switch" />
        <${Checkbox} checked=${cb} onChange=${setCb} label="Checkbox" />
      </div>
      <${RadioGroup} legend="Radio" name=${`r-${scope}`} value=${radio} onChange=${setRadio}
        options=${[{ value: 'one', label: 'Doar această sesiune', hint: 'Hint' }, { value: 'all', label: 'Toată seria' }]} />
      <${ColorPicker} value=${color} onChange=${setColor} legend="Colour" />
      <${Segmented} label="View" value=${seg} onChange=${setSeg}
        options=${[{ value: 'year', label: 'An' }, { value: 'month', label: 'Lună' }, { value: 'week', label: 'Săptămână' }, { value: 'day', label: 'Zi', disabled: true }]} />
      <${Tabs} label="Tabs" value=${tab} onChange=${setTab}
        items=${[{ value: 'all', label: 'Toate', count: 12 }, { value: 'events', label: 'Evenimente', count: 8 }, { value: 'blocks', label: 'Blocări', count: 0 }]} />
    </section>

    <section class="stack">
      <h2>${t('styleguide.feedback')}</h2>
      <div class="cluster">
        <${Badge}>Neutral</${Badge}><${Badge} tone="accent">Accent</${Badge}><${Badge} tone="success">Published</${Badge}>
        <${Badge} tone="warning">Warning</${Badge}><${Badge} tone="danger">Danger</${Badge}><${Badge} tone="info">Info</${Badge}>
        <${Badge} tone="event" icon="ticket">Eveniment</${Badge}><${Badge} tone="blocked" icon="lock">Blocare</${Badge}>
        <${Badge} tone="room" icon="bed">Cazare</${Badge}>
      </div>
      <div class="cluster">
        <span class="chip">Chip</span><span class="chip chip--selected">Selected</span>
        <span class="chip">Removable<button type="button" class="chip-remove" aria-label=${t('common.remove')}><${Icon} name="x" /></button></span>
      </div>
      <${Alert} tone="info" title="Info">${t('styleguide.sampleText')}</${Alert}>
      <${Alert} tone="warning">Warning</${Alert}>
      <${Alert} tone="danger">Danger</${Alert}>
      <${Alert} tone="success">Success</${Alert}>
      <div class="banner"><${Icon} name="triangle-alert" />Banner 82%</div>
      <div class="banner banner--danger"><${Icon} name="circle-alert" />Banner 93%</div>
      <${Button} onClick=${() => toast('success', t('styleguide.sampleToast'))}>Toast</${Button}>
      <${Progress} value=${0.42} label="Upload" />
      <${Meter} value=${0.84} label="Storage" level="warn" />
      <${Meter} value=${0.95} label="Storage" level="critical" />
      <div class="stack" style=${{ '--stack-gap': 'var(--space-2)' }}><${Skeleton} w="60%" /><${Skeleton} /><${Skeleton} h="48px" /></div>
    </section>

    <section class="stack">
      <h2>${t('styleguide.data')}</h2>
      <div class="cluster">${['Anca Popescu', 'Alex Marinescu', 'Ioana D'].map((n, i) => html`<${Avatar} name=${n} color=${`owner-${i * 4 + 1}`} />`)}</div>
      <${DataTable} caption="Sample" columns=${[
        { key: 'name', label: 'Nume', primary: true, sort: (/** @type {any} */ r) => r.name },
        { key: 'role', label: 'Rol', render: (/** @type {any} */ r) => html`<${Badge}>${r.role}</${Badge}>` },
        { key: 'n', label: 'Viitoare', sort: (/** @type {any} */ r) => r.n },
      ]} rows=${[{ id: '1', name: 'Anca', role: 'admin', n: 4 }, { id: '2', name: 'Alex', role: 'user', n: 2 }]} />
      <${EmptyState} title="Nu aveți încă nimic programat" text=${t('styleguide.sampleText')} action=${html`<${Button} variant="primary" icon="plus">Programează</${Button}>`} />
    </section>

    <section class="stack">
      <h2>${t('styleguide.overlays')}</h2>
      <div class="cluster">
        <${Button} onClick=${() => setOpen('dialog')}>${t('styleguide.openDialog')}</${Button}>
        <${Button} onClick=${() => setOpen('sheet')}>${t('styleguide.openSheet')}</${Button}>
        <${Button} onClick=${() => setOpen('panel')}>${t('styleguide.openPanel')}</${Button}>
      </div>
      <${Modal} open=${!!open} kind=${open ?? 'dialog'} onClose=${() => setOpen(null)} title=${t('styleguide.sample')}
        footer=${html`<${Button} onClick=${() => setOpen(null)}>${t('common.cancel')}</${Button}><${Button} variant="primary" onClick=${() => setOpen(null)}>${t('common.save')}</${Button}>`}>
        <p>${t('styleguide.sampleText')}</p>
      </${Modal}>
    </section>
  </div>`;
}
