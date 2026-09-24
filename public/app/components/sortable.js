import { html, useState } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon, IconButton } from './ui.js';

/**
 * A reorderable list: drag the handle (mouse), or use the move up/down
 * buttons (keyboard and touch). Calls onReorder with the new id order.
 * @param {{items: any[], render: (item: any, i: number) => any, onReorder: (ids: string[]) => void, label: (item: any) => string,
 *   class?: string, disabled?: boolean}} p
 */
export function SortableList({ items, render, onReorder, label, class: cls = '', disabled }) {
  const [dragId, setDragId] = useState(/** @type {string|null} */ (null));
  const [overId, setOverId] = useState(/** @type {string|null} */ (null));

  /** @param {number} from @param {number} to */
  const move = (from, to) => {
    if (to < 0 || to >= items.length || from === to) return;
    const ids = items.map((x) => x.id);
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x);
    onReorder(ids);
  };

  return html`<ol class=${`sortable ${cls}`} role="list">
    ${items.map(
      (item, i) => html`<li key=${item.id} class=${`sortable-item ${overId === item.id && dragId !== item.id ? 'is-over' : ''} ${dragId === item.id ? 'is-dragging' : ''}`}
        onDragOver=${(/** @type {DragEvent} */ e) => {
          if (!dragId) return;
          e.preventDefault();
          setOverId(item.id);
        }}
        onDrop=${(/** @type {DragEvent} */ e) => {
          e.preventDefault();
          if (dragId) move(items.findIndex((x) => x.id === dragId), i);
          setDragId(null);
          setOverId(null);
        }}>
        ${!disabled &&
        html`<div class="sortable-handle">
          <span class="drag-grip" draggable="true" title=${t('common.dragToReorder')} aria-hidden="true"
            onDragStart=${(/** @type {DragEvent} */ e) => {
              setDragId(item.id);
              e.dataTransfer?.setData('text/plain', item.id);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd=${() => (setDragId(null), setOverId(null))}><${Icon} name="grip-vertical" /></span>
          <div class="sortable-moves">
            <${IconButton} icon="chevron-up" size="sm" label=${t('common.moveUp', { name: label(item) })} disabled=${i === 0} onClick=${() => move(i, i - 1)} />
            <${IconButton} icon="chevron-down" size="sm" label=${t('common.moveDown', { name: label(item) })} disabled=${i === items.length - 1} onClick=${() => move(i, i + 1)} />
          </div>
        </div>`}
        <div class="sortable-body">${render(item, i)}</div>
      </li>`,
    )}
  </ol>`;
}
