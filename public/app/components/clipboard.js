import { t } from '../i18n/index.js';
import { toast } from './toast.js';

/** Copy text and confirm with a toast. @param {string} text @param {string} [done] */
export async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast('success', done ?? t('common.copied'));
    return true;
  } catch {
    toast('warning', t('common.copyFailed'));
    return false;
  }
}
