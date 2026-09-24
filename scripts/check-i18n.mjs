// Translation check: ro.json and en.json have identical keys, no duplicates,
// no unused keys, and every t('…') call references an existing key.
// Template calls such as t(`errors.${code}`) mark the whole prefix as used.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'public/app/i18n');
const errors = [];

/** Parse JSON, reporting duplicate keys, and return the flat key list. @param {string} file */
function flatKeys(file) {
  const src = fs.readFileSync(file, 'utf8');
  let i = 0;
  const keys = [];
  const ws = () => {
    while (/\s/.test(src[i])) i++;
  };
  const str = () => {
    let out = '';
    i++;
    while (src[i] !== '"') {
      if (src[i] === '\\') {
        out += src[i] + src[i + 1];
        i += 2;
      } else out += src[i++];
    }
    i++;
    return JSON.parse(`"${out}"`);
  };
  /** @param {string} prefix */
  const value = (prefix) => {
    ws();
    if (src[i] === '{') {
      i++;
      const seen = new Set();
      ws();
      while (src[i] !== '}') {
        ws();
        const k = str();
        if (seen.has(k)) errors.push(`${path.basename(file)}: duplicate key "${prefix}${k}"`);
        seen.add(k);
        ws();
        i++; // :
        value(`${prefix}${k}.`);
        ws();
        if (src[i] === ',') i++;
        ws();
      }
      i++;
    } else if (src[i] === '"') {
      str();
      keys.push(prefix.slice(0, -1));
    } else {
      throw new Error(`${file}: only objects and strings are allowed (at ${prefix})`);
    }
  };
  value('');
  return keys;
}

const ro = flatKeys(path.join(dir, 'ro.json'));
const en = flatKeys(path.join(dir, 'en.json'));
const roSet = new Set(ro);
const enSet = new Set(en);
for (const k of ro) if (!enSet.has(k)) errors.push(`en.json is missing "${k}"`);
for (const k of en) if (!roSet.has(k)) errors.push(`ro.json is missing "${k}"`);

/** @param {string} d @returns {string[]} */
function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return walk(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

const used = new Set();
const prefixes = new Set();
for (const file of walk(path.join(root, 'public/app'))) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) {
    used.add(m[1]);
    if (!roSet.has(m[1])) errors.push(`${path.relative(root, file)}: unknown key "${m[1]}"`);
  }
  for (const m of src.matchAll(/\bt\(\s*`([^`$]*)\$\{/g)) prefixes.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*`([^`$]+)`/g)) {
    used.add(m[1]);
    if (!roSet.has(m[1])) errors.push(`${path.relative(root, file)}: unknown key "${m[1]}"`);
  }
  // Keys referenced as data or in expressions, e.g. { key: 'nav.calendar' } or a ? 'x.y' : 'x.z'
  for (const m of src.matchAll(/'([a-zA-Z]+\.[a-zA-Z0-9_.]+)'/g)) if (roSet.has(m[1])) used.add(m[1]);
}
for (const k of ro) {
  if (used.has(k)) continue;
  if ([...prefixes].some((p) => p && k.startsWith(p))) continue;
  errors.push(`unused key "${k}"`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`i18n: ${ro.length} keys, ok`);
