// Front-end packages loaded through the import map. Versions must match
// package.json devDependencies and server/importmap.cdn.json (checked in CI).
export const PACKAGES = [
  { name: 'preact', version: '10.29.8', entries: { preact: 'dist/preact.module.js', 'preact/hooks': 'hooks/dist/hooks.module.js' } },
  { name: '@preact/signals-core', version: null, entries: { '@preact/signals-core': 'dist/signals-core.module.js' } },
  { name: '@preact/signals', version: '2.11.2', entries: { '@preact/signals': 'dist/signals.module.js' } },
  { name: 'htm', version: '3.1.1', entries: { htm: 'dist/htm.module.js', 'htm/preact': 'preact/index.module.js' } },
  { name: 'preact-iso', version: '2.12.2', entries: { 'preact-iso': 'src/index.js' } },
  { name: 'zod', version: '4.6.5', entries: { zod: 'index.js' } },
  { name: '@simplewebauthn/browser', version: '14.0.0', entries: { '@simplewebauthn/browser': 'esm/index.js' } },
  {
    name: 'temporal-utils',
    version: null,
    entries: {
      'temporal-utils': 'dist/index.js',
      'temporal-utils/protected': 'dist/protected.js',
      'temporal-utils/protected-error-messages': 'dist/protected-error-messages.js',
    },
  },
  { name: 'temporal-polyfill', version: '1.0.5', entries: { 'temporal-polyfill': 'global.esm.js' } },
];
