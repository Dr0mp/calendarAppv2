import { test, expect, demoAdmin, expectPhoneLayout } from './helpers.js';

// Visual baselines (§13) for the key screens beyond the calendar (see
// calendar.spec.js): both themes, both languages, desktop and phone.
// Baselines are kept for Chromium. The clock is frozen, the demo is reset
// before each test, and external images are blocked so they always show
// the same fallback.

const SCREENS = [
  { name: 'schedule', url: '/schedule' },
  { name: 'my-events', url: '/my-events' },
  { name: 'social-month', url: '/social?view=month' },
  { name: 'social-list', url: '/social?view=list' },
  { name: 'queue', url: '/social/queue' },
  { name: 'admin', url: '/admin' },
];

/** Grow the viewport to the page height before a full-page shot (v1 lesson). @param {import('@playwright/test').Page} page */
async function fitHeight(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: page.viewportSize()?.width ?? 1280, height: Math.min(Math.max(height, 600), 3000) });
}

test.describe('visual', () => {
  for (const locale of ['ro', 'en']) {
    for (const theme of ['light', 'dark']) {
      test(`key screens ${locale} ${theme}`, async ({ page, request }, info) => {
        test.skip(info.project.name.split('-')[0] !== 'chromium', 'baselines are kept for Chromium');
        test.setTimeout(90_000);
        await page.route(/^https:\/\//, (route) => route.abort());
        await page.emulateMedia({ colorScheme: /** @type {'light'|'dark'} */ (theme), reducedMotion: 'reduce' });
        await demoAdmin(page, request, locale);
        for (const s of SCREENS) {
          await page.setViewportSize(info.project.name.includes('phone') ? { width: 390, height: 844 } : { width: 1280, height: 800 });
          await page.goto(s.url);
          await page.waitForLoadState('networkidle');
          await page.mouse.move(0, 0);
          await fitHeight(page);
          await expect(page).toHaveScreenshot(`${s.name}-${locale}-${theme}.png`, { fullPage: true, maxDiffPixelRatio: 0.02 });
        }
      });
    }
  }

  test('sign-in page', async ({ page }, info) => {
    test.skip(info.project.name.split('-')[0] !== 'chromium', 'baselines are kept for Chromium');
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: /** @type {'light'|'dark'} */ (theme), reducedMotion: 'reduce' });
      await page.goto('/login');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`login-${theme}.png`, { fullPage: true, maxDiffPixelRatio: 0.02 });
    }
  });
});

test('flow 12: on a phone, every page fits the width and keeps the bottom bar on screen', async ({ page, request }, info) => {
  test.skip(!info.project.name.includes('phone'), 'phone layout only');
  test.setTimeout(90_000);
  await demoAdmin(page, request);
  for (const url of [
    '/calendar?view=month', '/calendar?view=day', '/calendar?view=agenda', '/schedule', '/my-events', '/account',
    '/social?view=month', '/social?view=year', '/social?view=list', '/social?edit=new', '/social/queue', '/social/platforms', '/social/standards',
    '/admin', '/admin/users', '/admin/spaces', '/admin/rooms', '/admin/entries', '/admin/storage', '/admin/settings',
  ]) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await expectPhoneLayout(page);
  }
});
