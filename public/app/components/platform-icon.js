import { html, useEffect, useState } from '../html.js';

/**
 * A platform's icon: the uploaded icon or stored favicon, otherwise a
 * coloured circle with the platform's initial.
 * @param {{platform: {name: string, color: string, icon_url?: string|null}|null|undefined, size?: number, class?: string}} p
 */
export function PlatformIcon({ platform, size = 18, class: cls = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [platform?.icon_url]);
  if (!platform) return null;
  const style = { '--pi-size': `${size}px`, '--pi-color': platform.color };
  if (platform.icon_url && !failed) {
    return html`<img class=${`platform-icon ${cls}`} src=${platform.icon_url} alt="" width=${size} height=${size} style=${style}
      onError=${() => setFailed(true)} />`;
  }
  return html`<span class=${`platform-icon platform-icon--initial ${cls}`} style=${style} aria-hidden="true">${platform.name.trim().charAt(0).toUpperCase()}</span>`;
}
