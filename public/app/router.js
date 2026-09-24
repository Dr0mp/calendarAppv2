import { lazy } from 'preact-iso';

// Every page is a lazily loaded module.
export const pages = {
  login: lazy(() => import('./pages/login/login.js')),
  forgot: lazy(() => import('./pages/login/forgot.js')),
  token: lazy(() => import('./pages/login/token.js')),
  calendar: lazy(() => import('./pages/calendar/calendar.js')),
  schedule: lazy(() => import('./pages/schedule/schedule.js')),
  entry: lazy(() => import('./pages/entry/entry-page.js')),
  myEntries: lazy(() => import('./pages/my-entries/my-entries.js')),
  social: lazy(() => import('./pages/social/social.js')),
  platforms: lazy(() => import('./pages/social/platforms.js')),
  standards: lazy(() => import('./pages/social/standards.js')),
  admin: lazy(() => import('./pages/admin/admin.js')),
  account: lazy(() => import('./pages/account/account.js')),
  styleguide: lazy(() => import('./pages/dev/styleguide.js')),
};

/** Paths that don't need a session. */
export const PUBLIC = [/^\/login$/, /^\/forgot$/, /^\/invite\/[^/]+$/, /^\/reset\/[^/]+$/];

/** Which role a path needs. @param {string} path */
export function requiredRole(path) {
  if (path.startsWith('/social') || path.startsWith('/admin') || path.startsWith('/dev/')) return 'admin';
  return 'user';
}

/** @param {string} path @param {{role: string}|null} user */
export function allowed(path, user) {
  if (!user) return false;
  return requiredRole(path) !== 'admin' || user.role === 'admin';
}
