// Promotion helpers (§6.7): the caption template and the default date.
import { addDays, isPastMoment, nextFullHour } from './time.js';

const PLACEHOLDER = /\{([a-z_]+)\}/g;

/**
 * Fill a caption template. A line is dropped when any placeholder in it has
 * no value; unknown placeholders count as empty. Runs of blank lines collapse.
 * @param {string} template @param {Record<string, string|null|undefined>} values
 */
export function fillTemplate(template, values) {
  const lines = [];
  for (const line of template.split(/\r?\n/)) {
    const names = [...line.matchAll(PLACEHOLDER)].map((m) => m[1]);
    if (names.some((n) => !String(values[n] ?? '').trim())) continue;
    lines.push(line.replace(PLACEHOLDER, (_, n) => String(values[n]).trim()));
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * When a promotion post goes out by default: 7 days before the first
 * session at 10:00, or the next full hour when that is already past.
 * @param {string} firstDate @param {string} tz @param {number} [at]
 */
export function promoSlot(firstDate, tz, at) {
  const date = addDays(firstDate, -7);
  if (!isPastMoment(date, '10:00', tz, at)) return { date, time: '10:00' };
  return nextFullHour(tz, at);
}
