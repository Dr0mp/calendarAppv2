// Copy the ESM builds of the front-end libraries into public/vendor/ and write
// importmap.local.json (with subresource integrity) for ASSETS=local installs.
// Also refreshes the self-hosted Inter font in public/fonts/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGES } from './vendor-packages.mjs';

const root = path.resolve(import.meta.dirname, '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'public', 'vendor');

fs.rmSync(out, { recursive: true, force: true });
/** @type {Record<string,string>} */ const imports = {};
/** @type {Record<string,string>} */ const integrity = {};

const keep = (f) => /\.(m?js)$/.test(f) && !/\.d\.[cm]?ts$/.test(f) && !f.endsWith('.cjs');

function copyDir(src, dst, urlBase) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (['src', 'node_modules', 'test', 'tests'].includes(entry.name) && src !== dst) {
      // Skip TypeScript sources (zod ships `src/`), except packages whose ESM lives in src/.
      if (!(entry.name === 'src' && fs.existsSync(path.join(src, 'src', 'index.js')))) continue;
    }
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d, `${urlBase}${entry.name}/`);
    else if (keep(entry.name)) {
      fs.mkdirSync(dst, { recursive: true });
      const buf = fs.readFileSync(s);
      fs.writeFileSync(d, buf);
      integrity[`${urlBase}${entry.name}`] = `sha384-${crypto.createHash('sha384').update(buf).digest('base64')}`;
    }
  }
}

for (const pkg of PACKAGES) {
  const dir = path.join(nm, pkg.name);
  const actual = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  if (pkg.version && actual !== pkg.version) {
    throw new Error(`${pkg.name}: installed ${actual}, expected ${pkg.version}. Run npm ci.`);
  }
  const base = `/vendor/${pkg.name}@${actual}/`;
  copyDir(dir, path.join(out, `${pkg.name}@${actual}`), base);
  for (const [spec, file] of Object.entries(pkg.entries)) imports[spec] = base + file;
}

fs.writeFileSync(path.join(root, 'importmap.local.json'), `${JSON.stringify({ imports, integrity }, null, 2)}\n`);

// Fonts (latin + latin-ext, which covers Romanian diacritics).
const fontSrc = path.join(nm, '@fontsource-variable/inter/files');
const fontDst = path.join(root, 'public', 'fonts');
fs.mkdirSync(fontDst, { recursive: true });
for (const f of ['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2']) {
  fs.copyFileSync(path.join(fontSrc, f), path.join(fontDst, f));
}
console.log(`vendor: ${Object.keys(integrity).length} files, ${Object.keys(imports).length} import specifiers`);
