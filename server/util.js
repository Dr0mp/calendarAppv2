import { v7 as uuidv7 } from 'uuid';

export const newId = () => uuidv7();

/** ISO-8601 UTC without milliseconds, e.g. 2026-09-24T10:00:00Z. @param {Date|number} [d] */
export function isoNow(d = new Date()) {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** @param {number} ms */
export const isoIn = (ms) => isoNow(Date.now() + ms);

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
