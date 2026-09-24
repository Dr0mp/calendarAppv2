import { test, expect, apiInPage, demoAdmin, dayFromToday, expectPhoneLayout, fakeImages } from './helpers.js';

const TODAY = dayFromToday(0);

test.describe('calendar', () => {
  test.beforeEach(async ({ page, request }) => {
    await fakeImages(page);
    await demoAdmin(page, request);
  });

  test('views are real URLs: reload restores, Back works, keyboard shortcuts', async ({ page, isMobile }) => {
    await page.goto(`/calendar?view=month&date=${TODAY.slice(0, 7)}`);
    await expect(page.locator('.cal-label')).toHaveText(/Septembrie 2026/);
    await page.getByRole('button', { name: 'Perioada următoare' }).click();
    await expect(page).toHaveURL(/date=2026-10/);
    await expect(page.locator('.cal-label')).toHaveText(/Octombrie 2026/);
    await page.reload();
    await expect(page.locator('.cal-label')).toHaveText(/Octombrie 2026/);
    await page.goBack();
    await expect(page.locator('.cal-label')).toHaveText(/Septembrie 2026/);
    if (!isMobile) {
      await page.locator('body').press('y');
      await expect(page).toHaveURL(/view=year&date=2026/);
      await page.locator('body').press('d');
      await expect(page).toHaveURL(/view=day/);
      await page.locator('body').press('ArrowRight');
      await expect(page).toHaveURL(new RegExp(`date=${dayFromToday(1)}`));
      await page.locator('body').press('t');
      await expect(page).toHaveURL(new RegExp(`date=${TODAY}`));
      await page.locator('body').press('w');
      await expect(page).toHaveURL(/view=week/);
    }
  });

  test('year view counts entries spanning a month and opens days', async ({ page }) => {
    await page.goto('/calendar?view=year&date=2026');
    const oct = page.locator('.mini-month').filter({ has: page.getByRole('button', { name: 'octombrie' }) });
    await expect(oct.locator('.count')).not.toHaveText('0');
    await page.locator(`.mini-day[data-date="${TODAY}"]`).click();
    await expect(page).toHaveURL(new RegExp(`view=day&date=${TODAY}`));
  });

  test('filters: popover with counts, chips in the URL, removable', async ({ page }) => {
    await page.goto(`/calendar?view=agenda`);
    await page.getByRole('button', { name: /^Filtre/ }).click();
    const blocked = page.locator('.filter-opt').filter({ hasText: 'Blocare interval' });
    await expect(blocked.locator('.count')).toHaveText('1');
    await blocked.getByRole('checkbox').check();
    await expect(page).toHaveURL(/type=blocked/);
    await page.keyboard.press('Escape');
    const chip = page.locator('.filter-chips .chip').filter({ hasText: 'Blocare interval' });
    await expect(chip).toBeVisible();
    await expect(page.locator('.agenda-row')).toHaveCount(1);
    await chip.getByRole('button').click();
    await expect(page).not.toHaveURL(/type=/);
    await expect(page.locator('.agenda-row').first()).toBeVisible();
  });

  test('search dims non-matching entries outside the agenda and filters the agenda', async ({ page, isMobile }) => {
    await page.goto(`/calendar?view=month&date=2026-10`);
    await page.getByRole('searchbox').fill('masterclass');
    if (isMobile) {
      await expect(page.locator('.mday-bars i[data-dim="true"]').first()).toBeAttached();
      await expect(page.locator('.mday-bars i:not([data-dim])').first()).toBeAttached();
    } else {
      await expect(page.locator('.entry-chip[data-hit="true"]').first()).toBeVisible();
      await expect(page.locator('.entry-chip[data-dim="true"]').first()).toBeVisible();
    }
    await page.goto(`/calendar?view=agenda&q=masterclass`);
    await expect(page.locator('.agenda-row')).toHaveCount(3);
  });

  test('week and day: overlapping sessions side by side, now line, slot click creates', async ({ page, isMobile }) => {
    const d = dayFromToday(1);
    const spaces = (await apiInPage(page, 'GET', '/spaces')).data.items;
    const base = { type: 'event', enroll_url: 'https://example.com/x', cover_url: 'https://img.test/c.webp', price_cents: null };
    expect((await apiInPage(page, 'POST', '/entries', { entry: { ...base, title: 'Primul', space_id: spaces[0].id, sessions: [{ date: d, start: '10:00', end: '12:00' }] } })).status).toBe(201);
    expect((await apiInPage(page, 'POST', '/entries', { entry: { ...base, title: 'Al doilea', space_id: spaces[1].id, sessions: [{ date: d, start: '11:00', end: '13:00' }] } })).status).toBe(201);
    await page.goto(`/calendar?view=day&date=${d}`);
    const a = await page.locator('.tg-block').filter({ hasText: 'Primul' }).boundingBox();
    const b = await page.locator('.tg-block').filter({ hasText: 'Al doilea' }).boundingBox();
    expect(a && b).toBeTruthy();
    expect(Math.abs((a?.x ?? 0) - (b?.x ?? 0))).toBeGreaterThan(20);
    expect((a?.width ?? 0) + (b?.width ?? 0)).toBeLessThan(((await page.locator('.tg-col').first().boundingBox())?.width ?? 0) + 10);

    await page.goto(`/calendar?view=day&date=${TODAY}`);
    await expect(page.locator('.tg-now')).toBeVisible();

    if (isMobile) {
      // Swipe to the next day.
      await page.locator('.tg-scroll').dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: 300, clientY: 400 }] });
      await page.locator('.tg-scroll').dispatchEvent('touchend', { changedTouches: [{ identifier: 0, clientX: 100, clientY: 410 }] });
      await expect(page).toHaveURL(new RegExp(`date=${dayFromToday(1)}`));
    }

    await page.goto(`/calendar?view=day&date=${dayFromToday(2)}`);
    await page.getByRole('gridcell', { name: /15:00: liber, programează/ }).click();
    if (isMobile) await expect(page).toHaveURL(new RegExp(`/schedule\\?date=${dayFromToday(2)}&time=15`));
    else await expect(page.getByRole('dialog', { name: 'Programează' })).toBeVisible();
    await expect(page.locator('#f-sessions-0-start')).toHaveValue('15:00');
    if (!isMobile) {
      // Quick-create from the side panel, then the detail opens over the calendar.
      await page.getByRole('radio', { name: 'Blocare interval' }).click();
      await page.locator('#f-title').fill('Rapid din calendar');
      await page.getByRole('button', { name: 'Confirmă blocarea' }).click();
      await expect(page).toHaveURL(/entry=/);
      await expect(page.getByRole('dialog').filter({ hasText: 'Blocare interval' })).toBeVisible();
      await expect(page.locator('.tg-block').filter({ hasText: 'Rapid din calendar' })).toBeVisible();
    }
  });

  test('month: phones open a day sheet; desktop shows chips and opens the detail', async ({ page, isMobile }) => {
    await page.goto(`/calendar?view=month&date=2026-10`);
    const day = page.locator(`.mday[data-date="${dayFromToday(8)}"]`);
    if (isMobile) {
      await day.click();
      const sheet = page.getByRole('dialog');
      await expect(sheet).toContainText('Masterclass');
      await expect(sheet.getByRole('button', { name: 'Programează în această zi' })).toBeVisible();
      await sheet.getByRole('button', { name: /Masterclass/ }).click();
    } else {
      await day.locator('.entry-chip').first().click();
    }
    await expect(page).toHaveURL(/entry=/);
    await expect(page.getByRole('dialog').filter({ hasText: 'Studio Video 2B' })).toBeVisible();
    await expectPhoneLayout(page);
  });

  test('keyboard: arrows move between days in the month grid; Enter opens', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop keyboard');
    await page.goto(`/calendar?view=month&date=${TODAY.slice(0, 7)}`);
    await page.locator(`.mday[data-date="${TODAY}"]`).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(`.mday[data-date="${dayFromToday(1)}"]`)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(`.mday[data-date="${dayFromToday(8)}"]`)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`view=day&date=${dayFromToday(8)}`));
  });
});

test.describe('visual', () => {
  for (const locale of ['ro', 'en']) {
    for (const theme of ['light', 'dark']) {
      test(`calendar ${locale} ${theme}`, async ({ page, request }, info) => {
        test.skip(info.project.name.split('-')[0] !== 'chromium', 'baselines are kept for Chromium');
        await page.emulateMedia({ colorScheme: /** @type {'light'|'dark'} */ (theme), reducedMotion: 'reduce' });
        await demoAdmin(page, request, locale);
        for (const view of ['month', 'week', 'agenda']) {
          if (view === 'week' && info.project.name.includes('phone')) continue;
          await page.goto(`/calendar?view=${view}&date=${view === 'month' ? '2026-10' : '2026-09-28'}`);
          await page.waitForLoadState('networkidle');
          await page.mouse.move(0, 0);
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.setViewportSize({ width: page.viewportSize()?.width ?? 1280, height: Math.min(height, 3000) });
          await expect(page).toHaveScreenshot(`calendar-${view}-${locale}-${theme}.png`, {
            fullPage: true,
            mask: [page.locator('.tg-now')],
            maxDiffPixelRatio: 0.02,
          });
        }
      });
    }
  }
});
