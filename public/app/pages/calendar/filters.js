import { html } from '../../html.js';
import { t } from '../../i18n/index.js';
import { spaces, directory } from '../../state/venues.js';
import { Icon } from '../../components/ui.js';
import { Popover } from '../../components/overlay.js';
import { applyFilters } from './model.js';

const TYPES = ['event', 'blocked', 'room_only'];

/**
 * The filter popover: entry type and space (multi-select), owner (all, mine,
 * or a user). Each option shows its entry count for the visible period.
 * @param {{entries: any[], filters: {types: string[], spaces: string[], owner: string}, me: string,
 *   onChange: (patch: Record<string, string|null>) => void}} p
 */
export function FilterPopover({ entries, filters, me, onChange }) {
  const active = filters.types.length + filters.spaces.length + (filters.owner ? 1 : 0);
  const byType = applyFilters(entries, filters, me, 'types');
  const bySpace = applyFilters(entries, filters, me, 'spaces');
  const byOwner = applyFilters(entries, filters, me, 'owner');
  const owners = new Map();
  for (const e of byOwner) owners.set(e.owner.id, (owners.get(e.owner.id) ?? 0) + 1);

  /** @param {'type'|'space'} key @param {string[]} cur @param {string} v */
  const toggle = (key, cur, v) => {
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onChange({ [key]: next.join(',') || null });
  };

  return html`<${Popover} align="end" label=${t('calendar.filters')} class="filter-pop"
    trigger=${(/** @type {any} */ p) => html`<button type="button" class=${`btn btn--secondary ${active ? 'is-active' : ''}`} ref=${p.ref} onClick=${p.toggle}
      aria-expanded=${p['aria-expanded']} aria-haspopup="dialog" aria-label=${active ? `${t('calendar.filters')} (${active})` : t('calendar.filters')}>
      <${Icon} name="list-filter" /><span class="hide-phone">${t('calendar.filters')}</span>${active > 0 && html`<span class="count count--accent">${active}</span>`}
    </button>`}>
    ${() => html`<div class="filter-body">
      <fieldset>
        <legend class="section-title">${t('calendar.filterType')}</legend>
        ${TYPES.map(
          (x) => html`<label class="check filter-opt">
            <input type="checkbox" checked=${filters.types.includes(x)} onChange=${() => toggle('type', filters.types, x)} />
            <span class="grow">${t(`entryType.${x}`)}</span><span class="count">${byType.filter((e) => e.type === x).length}</span>
          </label>`,
        )}
      </fieldset>
      <fieldset>
        <legend class="section-title">${t('calendar.filterSpace')}</legend>
        ${(spaces.value ?? []).map(
          (s) => html`<label class="check filter-opt">
            <input type="checkbox" checked=${filters.spaces.includes(s.id)} onChange=${() => toggle('space', filters.spaces, s.id)} />
            <span class="grow">${s.name}</span><span class="count">${bySpace.filter((e) => e.space_id === s.id).length}</span>
          </label>`,
        )}
      </fieldset>
      <fieldset>
        <legend class="section-title">${t('calendar.filterOwner')}</legend>
        <label class="check filter-opt"><input type="radio" name="owner" checked=${!filters.owner} onChange=${() => onChange({ owner: null })} />
          <span class="grow">${t('calendar.ownerAll')}</span><span class="count">${byOwner.length}</span></label>
        <label class="check filter-opt"><input type="radio" name="owner" checked=${filters.owner === 'me'} onChange=${() => onChange({ owner: 'me' })} />
          <span class="grow">${t('calendar.ownerMine')}</span><span class="count">${owners.get(me) ?? 0}</span></label>
        <select class="select" aria-label=${t('calendar.ownerSpecific')} value=${filters.owner && filters.owner !== 'me' ? filters.owner : ''}
          onChange=${(/** @type {any} */ e) => onChange({ owner: e.currentTarget.value || null })}>
          <option value="">${t('calendar.ownerSpecific')}</option>
          ${(directory.value ?? []).map((u) => html`<option value=${u.id} selected=${filters.owner === u.id}>${u.name} (${owners.get(u.id) ?? 0})</option>`)}
        </select>
      </fieldset>
      ${(filters.types.length || filters.spaces.length || filters.owner) &&
      html`<button type="button" class="link-btn small" onClick=${() => onChange({ type: null, space: null, owner: null })}>${t('calendar.clearFilters')}</button>`}
    </div>`}
  </${Popover}>`;
}

/**
 * Active filters as removable chips under the header.
 * @param {{filters: {types: string[], spaces: string[], owner: string}, onChange: (patch: Record<string, string|null>) => void}} p
 */
export function FilterChips({ filters, onChange }) {
  /** @type {{key: string, label: string, remove: () => void}[]} */
  const chips = [];
  for (const x of filters.types) {
    chips.push({ key: `t${x}`, label: t(`entryType.${x}`), remove: () => onChange({ type: filters.types.filter((y) => y !== x).join(',') || null }) });
  }
  for (const id of filters.spaces) {
    const s = spaces.value?.find((z) => z.id === id);
    chips.push({ key: `s${id}`, label: s?.name ?? '…', remove: () => onChange({ space: filters.spaces.filter((y) => y !== id).join(',') || null }) });
  }
  if (filters.owner) {
    const name = filters.owner === 'me' ? t('calendar.ownerMine') : directory.value?.find((u) => u.id === filters.owner)?.name ?? '…';
    chips.push({ key: 'o', label: name, remove: () => onChange({ owner: null }) });
  }
  if (!chips.length) return null;
  return html`<ul class="filter-chips cluster" role="list" aria-label=${t('calendar.activeFilters')}>
    ${chips.map(
      (c) => html`<li class="chip chip--selected" key=${c.key}>${c.label}
        <button type="button" class="chip-remove" aria-label=${t('calendar.removeFilter', { name: c.label })} onClick=${c.remove}><${Icon} name="x" /></button></li>`,
    )}
  </ul>`;
}
