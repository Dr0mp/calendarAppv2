import AxeBuilder from '@axe-core/playwright';
import { test, expect, signIn, ensureUser } from './helpers.js';

const PW = 'o parolă lungă și sigură';

/** Run axe and fail on serious or critical violations. @param {import('@playwright/test').Page} page */
async function audit(page, name) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n  ')}`).join('\n');
  expect(bad, `${name}\n${report}`).toEqual([]);
}

test.describe('accessibility', () => {
  test('sign-in page', async ({ page }) => {
    await page.goto('/login');
    await audit(page, 'login');
  });

  for (const theme of ['light', 'dark']) {
    test(`app pages (${theme})`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme: /** @type {'light'|'dark'} */ (theme) });
      await ensureUser(request, 'a11y.admin', PW, 'admin', { name: 'Admin A11y' });
      await signIn(page, 'a11y.admin', PW);
      await expect(page).toHaveURL(/calendar/);
      for (const url of [
        '/calendar?view=year',
        '/calendar?view=month',
        '/calendar?view=week',
        '/calendar?view=day',
        '/calendar?view=agenda',
        '/schedule',
        '/my-events',
        '/account',
        '/admin',
        '/admin/users',
        '/admin/spaces',
        '/admin/settings',
        '/social?view=year',
        '/social?view=month',
        '/social?view=list',
        '/social?edit=new',
        '/social/platforms',
        '/social/standards',
      ]) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await audit(page, `${url} (${theme})`);
      }
    });
  }
});
