// Series-aware operations. M3 handles single entries; M5 adds recurrence.
import { ApiError } from '../http/errors.js';
import * as entries from './entries.js';

/**
 * @typedef {import('../app.js').Workspace} Workspace
 * @typedef {import('../app.js').App} App
 * @typedef {import('./entries.js').Actor} Actor
 */

/**
 * @param {App} _app @param {Workspace} _ws @param {Actor} _actor @param {any} _entry @param {any} _rule
 * @returns {any[]}
 */
export function createSeries(_app, _ws, _actor, _entry, _rule) {
  throw new ApiError(400, 'recurrence_unavailable', 'Recurrence is not available yet');
}

/** Entry ids covered by a scope. @param {Workspace} ws @param {string} id @param {'one'|'following'|'all'} _scope */
export function scopeIds(ws, id, _scope) {
  entries.getEntryOr404(ws, id);
  return [id];
}

/** @param {App} app @param {Workspace} ws @param {Actor} actor @param {string} id @param {any} input @param {number} version @param {'one'|'following'|'all'} _scope */
export function updateScoped(app, ws, actor, id, input, version, _scope) {
  return entries.updateEntry(app, ws, actor, id, input, version);
}

/** @param {App} app @param {Workspace} ws @param {Actor} actor @param {string} id @param {number} version @param {'one'|'following'|'all'} _scope */
export function deleteScoped(app, ws, actor, id, version, _scope) {
  entries.deleteEntry(app, ws, actor, id, version);
  return 1;
}
