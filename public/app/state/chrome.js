import { signal } from '@preact/signals';
import { useEffect } from '../html.js';

/** Title and one contextual action for the compact (phone) top bar. */
export const chrome = signal(/** @type {{title: string, action?: any}} */ ({ title: '' }));

/** @param {string} title @param {any} [action] */
export function usePageChrome(title, action) {
  useEffect(() => {
    chrome.value = { title, action };
    document.title = title ? `${title} · Casa Artis` : 'Casa Artis';
  }, [title, action]);
}
