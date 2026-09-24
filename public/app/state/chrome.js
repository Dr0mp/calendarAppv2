import { signal } from '@preact/signals';
import { useEffect } from '../html.js';

/** Title and one contextual action for the compact (phone) top bar. */
export const chrome = signal(/** @type {{title: string, action?: any}} */ ({ title: '' }));

/**
 * Set the page title (document and phone top bar) and its one contextual
 * action. The action is read when the title changes, so pass a stable vnode.
 * @param {string} title @param {any} [action] @param {boolean} [skip] embedded pages leave the chrome alone
 */
export function usePageChrome(title, action, skip = false) {
  useEffect(() => {
    if (skip) return;
    chrome.value = { title, action };
    document.title = title ? `${title} · Casa Artis` : 'Casa Artis';
  }, [title]);
}
