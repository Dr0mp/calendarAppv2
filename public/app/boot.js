import { html, render } from './html.js';
import { refreshSession } from './state/session.js';
import { applyUserPrefs } from './state/prefs.js';

// The shell's modules load while the session and translations are fetched.
const shell = import('./shell.js');
await refreshSession();
await applyUserPrefs();
const { App } = await shell;
const root = /** @type {HTMLElement} */ (document.getElementById('app'));
root.replaceChildren();
render(html`<${App} />`, root);
