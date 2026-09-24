import { html, useMemo, useState } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from './ui.js';

/**
 * @typedef {{key: string, label: string, render?: (row: any) => any, sort?: (row: any) => string|number,
 *   primary?: boolean, actions?: boolean, class?: string}} Column
 */

/**
 * A table that becomes cards on narrow containers (container query; no JS).
 * @param {{columns: Column[], rows: any[], rowKey?: (r: any) => string, caption?: string, empty?: any,
 *   selectable?: boolean, selected?: Set<string>, onSelect?: (s: Set<string>) => void, initialSort?: {key: string, dir: 1|-1}}} p
 */
export function DataTable({ columns, rows, rowKey = (r) => r.id, caption, empty, selectable, selected, onSelect, initialSort }) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [rows, sort, columns]);

  if (!rows.length && empty) return empty;
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected?.has(rowKey(r)));

  /** @param {string} id @param {boolean} on */
  const toggle = (id, on) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelect?.(next);
  };

  return html`<div class="table-wrap">
    <table class="table">
      ${caption && html`<caption class="sr-only">${caption}</caption>`}
      <thead>
        <tr>
          ${selectable && html`<th scope="col"><input type="checkbox" aria-label=${t('common.selectAll')} checked=${allSelected}
            onChange=${(/** @type {any} */ e) => onSelect?.(e.currentTarget.checked ? new Set(rows.map(rowKey)) : new Set())} /></th>`}
          ${columns.map((c) => {
            if (!c.sort) return html`<th scope="col" class=${c.actions ? 'cell-actions' : ''}>${c.actions ? html`<span class="sr-only">${c.label}</span>` : c.label}</th>`;
            const active = sort?.key === c.key;
            const aria = active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none';
            return html`<th scope="col" aria-sort=${aria}>
              <button type="button" onClick=${() => setSort({ key: c.key, dir: active && sort.dir === 1 ? -1 : 1 })}>
                ${c.label}<${Icon} name=${active ? (sort.dir === 1 ? 'chevron-up' : 'chevron-down') : 'arrow-up-down'} />
              </button>
            </th>`;
          })}
        </tr>
      </thead>
      <tbody>
        ${sorted.map((r) => {
          const id = rowKey(r);
          return html`<tr key=${id} aria-selected=${selectable ? (selected?.has(id) ? 'true' : 'false') : undefined}>
            ${selectable && html`<td data-label=${t('common.select')}><input type="checkbox" aria-label=${t('common.select')}
              checked=${selected?.has(id)} onChange=${(/** @type {any} */ e) => toggle(id, e.currentTarget.checked)} /></td>`}
            ${columns.map(
              (c) => html`<td data-label=${c.label} class=${[c.primary && 'cell-primary', c.actions && 'cell-actions', c.class].filter(Boolean).join(' ')}>
                ${c.render ? c.render(r) : r[c.key]}
              </td>`,
            )}
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}
