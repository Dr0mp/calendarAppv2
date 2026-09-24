// Boot: load the Temporal polyfill only where the browser lacks Temporal
// (e.g. Safari), before any module that uses it is imported.
if (!globalThis.Temporal) await import('temporal-polyfill');
await import('./boot.js');
