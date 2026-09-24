// A small ICU MessageFormat subset: {name}, {n, number}, {n, plural, …} with
// =N / zero / one / few / many / other and #, and {x, select, …}.
// Uses Intl.PluralRules, so Romanian gets one/few/other and English one/other.

/** @typedef {string | {arg: string, type?: string, options?: Record<string, Node[]>, offset?: number}} Node */

/** @type {Map<string, Node[]>} */
const cache = new Map();

/** @param {string} src @returns {Node[]} */
export function parse(src) {
  let i = 0;
  /** @param {boolean} inPlural @returns {Node[]} */
  function message(inPlural) {
    /** @type {Node[]} */ const out = [];
    let text = '';
    while (i < src.length) {
      const ch = src[i];
      if (ch === '{') {
        if (text) out.push(text), (text = '');
        i++;
        out.push(argument());
      } else if (ch === '}') {
        break;
      } else if (ch === '#' && inPlural) {
        if (text) out.push(text), (text = '');
        out.push({ arg: '#' });
        i++;
      } else {
        text += ch;
        i++;
      }
    }
    if (text) out.push(text);
    return out;
  }
  function ws() {
    while (/\s/.test(src[i] ?? '')) i++;
  }
  function word() {
    ws();
    let w = '';
    while (i < src.length && /[^\s,{}]/.test(src[i])) w += src[i++];
    ws();
    return w;
  }
  /** @returns {Node} */
  function argument() {
    const arg = word();
    if (src[i] === '}') {
      i++;
      return { arg };
    }
    if (src[i] !== ',') throw new Error(`i18n: bad argument in "${src}"`);
    i++;
    const type = word();
    if (src[i] === '}') {
      i++;
      return { arg, type };
    }
    if (src[i] !== ',') throw new Error(`i18n: bad argument in "${src}"`);
    i++;
    /** @type {Record<string, Node[]>} */ const options = {};
    let offset = 0;
    ws();
    while (src[i] !== '}') {
      const key = word();
      if (key.startsWith('offset:')) {
        offset = Number(key.slice(7));
        continue;
      }
      if (src[i] !== '{') throw new Error(`i18n: expected { in "${src}"`);
      i++;
      options[key] = message(type === 'plural');
      if (src[i] !== '}') throw new Error(`i18n: unclosed option in "${src}"`);
      i++;
      ws();
    }
    i++;
    return { arg, type, options, offset };
  }
  const nodes = message(false);
  if (i < src.length) throw new Error(`i18n: unbalanced braces in "${src}"`);
  return nodes;
}

/**
 * Format a message.
 * @param {string} src
 * @param {Record<string, unknown>} [params]
 * @param {string} [locale] BCP 47, e.g. ro-RO
 */
export function formatMessage(src, params = {}, locale = 'ro-RO') {
  let nodes = cache.get(src);
  if (!nodes) {
    nodes = parse(src);
    cache.set(src, nodes);
  }
  return render(nodes, params, locale, null);
}

const pluralRules = new Map();
/** @param {string} locale */
function rules(locale) {
  let r = pluralRules.get(locale);
  if (!r) pluralRules.set(locale, (r = new Intl.PluralRules(locale)));
  return r;
}

/** @param {Node[]} nodes @param {Record<string, unknown>} params @param {string} locale @param {number|null} hash */
function render(nodes, params, locale, hash) {
  let out = '';
  for (const n of nodes) {
    if (typeof n === 'string') {
      out += n;
      continue;
    }
    if (n.arg === '#') {
      out += hash === null ? '#' : new Intl.NumberFormat(locale).format(hash);
      continue;
    }
    const v = params[n.arg];
    if (!n.type) {
      out += v === undefined || v === null ? '' : String(v);
    } else if (n.type === 'number') {
      out += new Intl.NumberFormat(locale).format(Number(v));
    } else if (n.type === 'plural' && n.options) {
      const num = Number(v) - (n.offset ?? 0);
      const exact = n.options[`=${Number(v)}`];
      const branch = exact ?? n.options[rules(locale).select(num)] ?? n.options.other ?? [];
      out += render(branch, params, locale, num);
    } else if (n.type === 'select' && n.options) {
      const branch = n.options[String(v)] ?? n.options.other ?? [];
      out += render(branch, params, locale, hash);
    }
  }
  return out;
}
