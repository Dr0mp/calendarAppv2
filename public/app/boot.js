import { html, render } from './html.js';
import { refreshSession } from './state/session.js';
import { applyUserPrefs } from './state/prefs.js';

await refreshSession();
await applyUserPrefs();
const { App } = await import('./shell.js');
const root = /** @type {HTMLElement} */ (document.getElementById('app'));
root.replaceChildren();
render(html`<${App} />`, root);
