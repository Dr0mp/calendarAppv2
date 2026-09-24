import js from '@eslint/js';
import globals from 'globals';

const noUnsafeHtml = {
  'no-restricted-properties': [
    'error',
    { property: 'innerHTML', message: 'Never write HTML strings into the DOM (spec §11.7).' },
    { property: 'outerHTML', message: 'Never write HTML strings into the DOM (spec §11.7).' },
    { property: 'insertAdjacentHTML', message: 'Never write HTML strings into the DOM (spec §11.7).' },
    { object: 'document', property: 'write', message: 'document.write is forbidden.' },
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "Identifier[name='dangerouslySetInnerHTML']", message: 'dangerouslySetInnerHTML is forbidden (spec §11.7).' },
    { selector: "Literal[value='dangerouslySetInnerHTML']", message: 'dangerouslySetInnerHTML is forbidden (spec §11.7).' },
    { selector: "TemplateElement[value.raw=/dangerouslySetInnerHTML|innerHTML/]", message: 'Raw HTML props are forbidden (spec §11.7).' },
  ],
};

export default [
  { ignores: ['node_modules/', 'public/vendor/', 'data/', 'test-results/', 'playwright-report/', 'coverage/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2025, sourceType: 'module' },
    rules: {
      ...noUnsafeHtml,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['public/**/*.js', 'shared/**/*.js'],
    languageOptions: { globals: { ...globals.browser, Temporal: 'readonly' } },
  },
  {
    files: ['server/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.js', 'tests/**/*.mjs', 'eslint.config.js', 'playwright.config.js', 'shared/**/*.js'],
    languageOptions: { globals: { ...globals.node, Temporal: 'readonly' } },
  },
  {
    // Playwright callbacks run inside the page.
    files: ['tests/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['scripts/**/*.mjs', 'server/app.js', 'tests/**/*.js', 'tests/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
];
