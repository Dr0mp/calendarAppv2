import { html } from '../html.js';

const URL_RE = /(https:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/**
 * Markdown-lite: line breaks and https links only, rendered as text nodes
 * (never HTML). Links open in a new tab with noopener noreferrer.
 * @param {{text: string}} p
 */
export function RichText({ text }) {
  const lines = String(text ?? '').split(/\r?\n/);
  return html`${lines.map(
    (line, i) => html`${i > 0 && html`<br />`}${line.split(URL_RE).map((part, j) =>
      j % 2 === 1 ? html`<a href=${part} target="_blank" rel="noopener noreferrer">${part}</a>` : part,
    )}`,
  )}`;
}
