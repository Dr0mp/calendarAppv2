// Build public/icons.svg: an inline SVG sprite with only the Lucide icons the
// app uses (plus custom ones), generated from lucide-static.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'node_modules/lucide-static/icons');

export const ICONS = [
  'calendar', 'calendar-plus', 'calendar-days', 'calendar-range', 'calendar-check', 'list', 'user', 'users', 'user-plus',
  'settings', 'log-out', 'log-in', 'sun', 'moon', 'monitor', 'languages', 'chevron-left', 'chevron-right',
  'chevron-down', 'chevron-up', 'plus', 'x', 'check', 'search', 'list-filter', 'lock', 'bed', 'clock', 'map-pin',
  'trash-2', 'pencil', 'copy', 'external-link', 'eye', 'eye-off', 'key-round', 'fingerprint', 'shield',
  'triangle-alert', 'info', 'circle-check', 'circle-x', 'circle-alert', 'ellipsis', 'ellipsis-vertical', 'menu',
  'house', 'building-2', 'door-open', 'image', 'video', 'images', 'upload', 'link', 'share-2', 'megaphone', 'send',
  'grip-vertical', 'download', 'database', 'hard-drive', 'refresh-cw', 'play', 'crop', 'repeat', 'sparkles',
  'ticket', 'mail', 'smartphone', 'laptop', 'arrow-right', 'arrow-left', 'layout-grid', 'printer', 'file-json',
  'undo-2', 'palette', 'tag', 'history', 'ban', 'user-round-cog', 'layers', 'clipboard-list', 'folder-open', 'star',
  'globe', 'badge-check', 'user-x', 'arrow-up-down', 'rotate-ccw', 'square-dashed', 'wand-sparkles', 'layout-list',
];

const parts = [];
for (const name of ICONS) {
  const file = path.join(src, `${name}.svg`);
  if (!fs.existsSync(file)) throw new Error(`lucide-static has no icon "${name}"`);
  const svg = fs.readFileSync(file, 'utf8');
  const body = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
  const inner = body.replace(/\s*\n\s*/g, '').trim();
  parts.push(`<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`);
}

const out =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<!-- Lucide icons (ISC licence), https://lucide.dev -->' +
  `${parts.join('')}</svg>\n`;
fs.writeFileSync(path.join(root, 'public/icons.svg'), out);
console.log(`icons: ${ICONS.length} symbols, ${out.length} bytes`);
