import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { preloadsFor } from './modgraph.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Build the HTML shell for the active ASSETS mode. The import map must be an
 * inline <script type="importmap">; its SHA-256 goes into the CSP so no other
 * inline script is ever allowed.
 * @param {'cdn'|'local'} assets
 */
export function buildShell(assets) {
  let map;
  if (assets === 'local') {
    const file = path.join(ROOT, 'importmap.local.json');
    if (!fs.existsSync(file)) {
      throw new Error('ASSETS=local but importmap.local.json is missing. Run `npm run vendor` first.');
    }
    map = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    map = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/importmap.cdn.json'), 'utf8'));
  }
  const json = JSON.stringify(map);
  const hash = crypto.createHash('sha256').update(json).digest('base64');
  const template = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const html = template.replace('<!--IMPORTMAP-->', `<script type="importmap">${json}</script>`);
  return { html, map, scriptHash: `'sha256-${hash}'`, cdnHost: assets === 'cdn' ? 'https://esm.sh' : '' };
}

/**
 * @param {{scriptHash: string, cdnHost: string}} shell
 */
export function contentSecurityPolicy(shell) {
  const cdn = shell.cdnHost ? ` ${shell.cdnHost}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' ${shell.scriptHash}${cdn}`,
    "style-src 'self'",
    "img-src 'self' blob: data: https:",
    "media-src 'self' blob: https:",
    "font-src 'self'",
    `connect-src 'self'${cdn}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * Personalise the shell: <html lang> and data-theme from the signed-in user,
 * so the first paint uses the right theme without an inline script; plus
 * preloads for the modules and the translations the first paint needs.
 * @param {{html: string, map: {imports: Record<string, string>}}} shell
 * @param {{locale?: string|null, theme?: string|null}|null} prefs
 * @param {string} [pathname]
 * @param {unknown} [session] the /api/v1/session payload, embedded as JSON data (not script) to save a round trip
 */
export function personalise(shell, prefs, pathname = '/', session) {
  const lang = prefs?.locale === 'en' ? 'en' : 'ro';
  const theme = ['light', 'dark'].includes(prefs?.theme ?? '') ? prefs.theme : 'system';
  const links = [
    `<link rel="preload" href="/app/i18n/${lang}.json" as="fetch" crossorigin />`,
    ...preloadsFor(pathname, shell.map).map((u) => `<link rel="modulepreload" href="${u}" />`),
    ...(session === undefined
      ? []
      : [`<script type="application/json" id="session-data">${JSON.stringify(session).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '')}</script>`]),
  ].join('\n    ');
  return shell.html
    .replace('<html lang="ro" data-theme="system">', `<html lang="${lang}" data-theme="${theme}">`)
    .replace('<!--PRELOADS-->', links);
}
