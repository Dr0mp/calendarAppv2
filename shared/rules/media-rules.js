// Media validation against a platform format (§6.3). Pure: used live in the
// post editor and again by the server before a post is saved as scheduled.

/**
 * @typedef {{media_kind: 'video'|'image'|'carousel', ratio_w: number, ratio_h: number, width: number, height: number,
 *   min_duration_s?: number|null, max_duration_s?: number|null, max_items?: number|null, max_file_mb?: number|null,
 *   caption_limit: number, hook_length?: number|null}} Format
 * @typedef {{kind?: 'image'|'video'|null, width?: number|null, height?: number|null, duration_s?: number|null, bytes?: number|null}} ItemInfo
 * @typedef {'ok'|'warning'|'error'} Level
 * @typedef {{code: string, level: Level, params?: Record<string, any>}} Check
 */

/** Allowed deviation from the format's aspect ratio. */
export const RATIO_TOLERANCE = 0.03;
/** Carousel size when the format sets no limit. */
export const DEFAULT_MAX_ITEMS = 20;

const VIDEO_EXT = /\.(mp4|m4v|mov|webm)(\?|#|$)/i;

/** Guess the kind of an external URL from its extension. @param {string} url */
export const kindOfUrl = (url) => (VIDEO_EXT.test(url) ? 'video' : 'image');

/** @param {number} w @param {number} h */
export function ratioLabel(w, h) {
  return `${w}:${h}`;
}

/** @param {Level[]} levels @returns {Level} */
export const worst = (levels) => (levels.includes('error') ? 'error' : levels.includes('warning') ? 'warning' : 'ok');

/**
 * Check one media item. Unknown metadata (an external URL that has not
 * loaded yet) is not reported.
 * @param {Format} f @param {ItemInfo} item
 * @returns {{level: Level, checks: Check[]}}
 */
export function checkItem(f, item) {
  /** @type {Check[]} */
  const checks = [];
  const want = f.media_kind === 'carousel' ? null : f.media_kind;
  if (item.kind && want && item.kind !== want) {
    checks.push({ code: 'kind_mismatch', level: 'error', params: { expected: want, actual: item.kind } });
  }
  if (item.width && item.height) {
    const target = f.ratio_w / f.ratio_h;
    const actual = item.width / item.height;
    if (Math.abs(actual - target) / target > RATIO_TOLERANCE) {
      checks.push({ code: 'ratio_off', level: 'warning', params: { expected: ratioLabel(f.ratio_w, f.ratio_h), actual: actual.toFixed(2) } });
    }
    if (item.width < f.width || item.height < f.height) {
      checks.push({ code: 'resolution_low', level: 'warning', params: { w: item.width, h: item.height, minW: f.width, minH: f.height } });
    }
  }
  if (item.kind === 'video' && item.duration_s != null) {
    if (f.min_duration_s != null && item.duration_s < f.min_duration_s) {
      checks.push({ code: 'too_short', level: 'error', params: { s: Math.round(item.duration_s), min: f.min_duration_s } });
    }
    if (f.max_duration_s != null && item.duration_s > f.max_duration_s) {
      checks.push({ code: 'too_long', level: 'error', params: { s: Math.round(item.duration_s), max: f.max_duration_s } });
    }
  }
  if (item.bytes != null && f.max_file_mb != null && item.bytes > f.max_file_mb * 1024 * 1024) {
    checks.push({ code: 'file_too_big', level: 'error', params: { mb: Math.ceil(item.bytes / 1024 / 1024), max: f.max_file_mb } });
  }
  return { level: worst(checks.map((c) => c.level)), checks };
}

/** How many items a format accepts. @param {Format} f */
export const maxItems = (f) => (f.media_kind === 'carousel' ? f.max_items || DEFAULT_MAX_ITEMS : 1);

/**
 * Checks that apply to the list as a whole.
 * @param {Format} f @param {number} n
 * @returns {Check[]}
 */
export function checkList(f, n) {
  const max = maxItems(f);
  return n > max ? [{ code: 'too_many_items', level: 'error', params: { n, max } }] : [];
}

/** Length in characters as a person counts them (code points). @param {string} s */
export const captionLength = (s) => [...(s ?? '')].length;

/**
 * Caption counter state: ok, past the hook ("… more" cut), or over the limit.
 * @param {Format} f @param {string} caption
 * @returns {{n: number, limit: number, hook: number|null, level: 'ok'|'hook'|'over'}}
 */
export function captionState(f, caption) {
  const n = captionLength(caption);
  const hook = f.hook_length ?? null;
  const level = n > f.caption_limit ? 'over' : hook != null && n > hook ? 'hook' : 'ok';
  return { n, limit: f.caption_limit, hook, level };
}

/**
 * Everything that blocks saving the post as scheduled. Warnings never block;
 * errors still allow a draft.
 * @param {Format} f @param {ItemInfo[]} items @param {string} caption
 * @returns {Check[]}
 */
export function scheduleBlockers(f, items, caption) {
  const out = [...checkList(f, items.length)];
  items.forEach((it, i) => {
    for (const c of checkItem(f, it).checks) if (c.level === 'error') out.push({ ...c, params: { ...c.params, index: i } });
  });
  const cap = captionState(f, caption);
  if (cap.level === 'over') out.push({ code: 'caption_too_long', level: 'error', params: { n: cap.n, max: cap.limit } });
  return out;
}

/**
 * The format that best fits an image: the first whose ratio is within the
 * tolerance, otherwise the first one.
 * @template {Format & {id: string}} F
 * @param {F[]} formats @param {number} w @param {number} h
 * @returns {F|undefined}
 */
export function formatForRatio(formats, w, h) {
  const r = w / h;
  return formats.find((f) => f.media_kind !== 'video' && Math.abs(r - f.ratio_w / f.ratio_h) / (f.ratio_w / f.ratio_h) <= RATIO_TOLERANCE) ?? formats[0];
}
