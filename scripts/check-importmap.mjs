// CI check: the CDN import map, the vendor list and package.json devDependencies
// must all pin the same versions. With ASSETS=local, vendored files must match
// the integrity hashes in importmap.local.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGES } from './vendor-packages.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const cdn = JSON.parse(fs.readFileSync(path.join(root, 'server/importmap.cdn.json'), 'utf8')).imports;
const errors = [];

for (const p of PACKAGES) {
  if (!p.version) continue;
  const dev = pkgJson.devDependencies?.[p.name] ?? pkgJson.dependencies?.[p.name];
  if (dev !== p.version) errors.push(`${p.name}: package.json has ${dev}, vendor list has ${p.version}`);
  for (const spec of Object.keys(p.entries)) {
    if (spec === 'htm' ) continue; // only needed by the local map (htm/preact imports it)
    const url = cdn[spec];
    if (!url) { errors.push(`${spec}: missing from importmap.cdn.json`); continue; }
    if (!url.includes(`${p.name}@${p.version}`)) errors.push(`${spec}: CDN url ${url} is not pinned to ${p.version}`);
    if (!/[?&]target=es2022/.test(url)) errors.push(`${spec}: CDN url must pin target=es2022`);
  }
}

const localFile = path.join(root, 'importmap.local.json');
if (fs.existsSync(localFile)) {
  const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
  for (const [url, hash] of Object.entries(local.integrity)) {
    const file = path.join(root, 'public', url);
    const actual = `sha384-${crypto.createHash('sha384').update(fs.readFileSync(file)).digest('base64')}`;
    if (actual !== hash) errors.push(`integrity mismatch: ${url}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('import map: ok');
