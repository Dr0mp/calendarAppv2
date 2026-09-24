import { test, expect, demoAdmin, expectPhoneLayout } from './helpers.js';

test.describe('promotion queue', () => {
  test.beforeEach(async ({ page, request }) => {
    await demoAdmin(page, request);
  });

  test('flow 7: create a post from an event → promoted; deleting it → pending again', async ({ page }) => {
    await page.goto('/social/queue');
    const pendingTab = page.getByRole('tab', { name: /De promovat/ });
    await expect(pendingTab).toContainText(/\d+/);
    const before = Number((await pendingTab.locator('.count').textContent()) ?? '0');
    const card = page.locator('.queue-card').first();
    const title = (await card.locator('.queue-title').textContent())?.trim() ?? '';
    expect(title).not.toBe('');

    await card.getByRole('button', { name: 'Creează postare' }).click();
    const ed = page.getByRole('dialog', { name: 'Postare nouă' });
    await expect(ed.getByText(`Promovează evenimentul: ${title}`)).toBeVisible();
    await expect(ed.getByLabel('Titlu')).toHaveValue(`Promovare: ${title}`);
    await expect(ed.getByLabel('Text')).toHaveValue(new RegExp(`^🚀 ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    await expect(ed.getByRole('combobox', { name: 'Platformă' })).toHaveValue(/.+/);
    await ed.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(page.getByText('Postarea a fost creată.')).toBeVisible();
    const detail = page.getByRole('dialog', { name: `Promovare: ${title}` });
    await expect(detail.getByRole('link', { name: title })).toBeVisible();
    await detail.getByRole('button', { name: 'Închide' }).click();

    await expect(page.locator('.queue-card', { hasText: title })).toHaveCount(0);
    await expect(pendingTab.locator('.count')).toHaveText(String(before - 1));
    await page.getByRole('tab', { name: /Promovate/ }).click();
    const promoted = page.locator('.queue-card', { hasText: title });
    await expect(promoted).toBeVisible();

    // Delete that post from the chip: the event returns to "De promovat".
    await promoted.locator('.post-link-chip').first().click();
    const post = page.getByRole('dialog', { name: `Promovare: ${title}` });
    await post.getByRole('button', { name: 'Șterge' }).click();
    await page.getByRole('dialog', { name: 'Ștergi postarea?' }).getByRole('button', { name: 'Șterge' }).click();
    await expect(page.getByText('Postarea a fost ștearsă.')).toBeVisible();
    await page.getByRole('tab', { name: /De promovat/ }).click();
    await expect(page.locator('.queue-card', { hasText: title })).toBeVisible();
    await expect(pendingTab.locator('.count')).toHaveText(String(before));
    await expectPhoneLayout(page);
  });

  test('skip and undo; the filters work', async ({ page }) => {
    await page.goto('/social/queue');
    const card = page.locator('.queue-card').first();
    const title = (await card.locator('.queue-title').textContent())?.trim() ?? '';
    await card.getByRole('button', { name: 'Ignoră' }).click();
    await expect(page.getByText(`„${title}” a fost ignorat.`)).toBeVisible();
    await expect(page.locator('.queue-card', { hasText: title })).toHaveCount(0);
    await page.getByRole('tab', { name: /Ignorate/ }).click();
    const skipped = page.locator('.queue-card', { hasText: title });
    await expect(skipped).toBeVisible();
    await skipped.getByRole('button', { name: 'Anulează ignorarea' }).click();
    await expect(page.locator('.queue-card', { hasText: title })).toHaveCount(0);
    await page.getByRole('tab', { name: /Toate/ }).click();
    await expect(page.locator('.queue-card', { hasText: title })).toBeVisible();
  });

  test('the planner shows the queue badge; the entry detail links to promotion', async ({ page }) => {
    await page.goto('/social');
    await expect(page.getByRole('link', { name: /Coadă promovare/ }).locator('.count')).toHaveText(/\d+/);
    await page.goto('/social/queue');
    const first = page.locator('.queue-card').first();
    await first.locator('.queue-title a').click();
    await expect(page.getByText('De promovat', { exact: true }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Creează postare' }).click();
    await expect(page.getByRole('dialog', { name: 'Postare nouă' }).getByText(/Promovează evenimentul/)).toBeVisible();
  });
});
