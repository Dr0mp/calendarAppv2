import sharp from 'sharp';
import { test, expect, apiInPage, demoAdmin, dayFromToday, expectPhoneLayout, signIn, ensureUser } from './helpers.js';

/** A solid-colour PNG. @param {number} w @param {number} h */
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 90, b: 60 } } }).png().toBuffer();

const isPhone = (/** @type {any} */ info) => info.project.name.includes('phone');

/** @param {import('@playwright/test').Page} page */
const editor = (page) => page.getByRole('dialog', { name: /Postare nouă|Editează postarea/ });

test.describe('social planner', () => {
  test.beforeEach(async ({ page, request }) => {
    await demoAdmin(page, request);
  });

  test('create a scheduled Instagram post with an uploaded image; it shows in month and list views', async ({ page }, info) => {
    await page.goto('/social');
    await expect(page.getByRole('heading', { name: 'septembrie 2026' })).toBeVisible();
    await page.goto('/social?edit=new');
    const ed = editor(page);
    await ed.getByRole('combobox', { name: 'Platformă' }).selectOption({ label: 'Instagram' });
    await ed.getByRole('combobox', { name: 'Format', exact: true }).selectOption({ label: 'Portrait Feed Post (4:5)' });
    await expect(ed.getByText('Standarde: Portrait Feed Post (4:5)')).toBeVisible();
    const day = dayFromToday(3);
    await ed.getByLabel('Dată publicare').fill(day);
    await ed.getByLabel('Oră publicare').fill('12:30');
    await ed.getByLabel('Titlu').fill('Lansare colecție de toamnă');
    await ed.locator('#p-media-file').setInputFiles({ name: 'toamna.png', mimeType: 'image/png', buffer: await png(1080, 1350) });
    await expect(ed.getByText('Conform formatului')).toBeVisible();
    await ed.getByLabel('Text').fill('Ședință foto pentru noua colecție 🍂');
    await expect(ed.getByText(/^\d+ \/ 2200$/)).toBeVisible();
    await ed.getByRole('radio', { name: 'Programat' }).click();
    await ed.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(page.getByText('Postarea a fost creată.')).toBeVisible();

    // The detail opens.
    const detail = page.getByRole('dialog', { name: 'Lansare colecție de toamnă' });
    await expect(detail).toBeVisible();
    await expect(detail.getByText('Programat')).toBeVisible();
    await expect(detail.locator('.carousel img')).toBeVisible();
    await detail.getByRole('button', { name: 'Închide' }).click();

    if (!isPhone(info)) {
      await expect(page.locator(`.mday[data-date="${day}"] .post-chip`, { hasText: 'Lansare colecție' })).toBeVisible();
    } else {
      await page.locator(`.mday[data-date="${day}"]`).click();
      const sheet = page.getByRole('dialog', { name: /sept/ });
      await expect(sheet.getByText('Lansare colecție de toamnă')).toBeVisible();
      await sheet.getByRole('button', { name: 'Închide' }).click();
    }
    // List view with a diacritics-insensitive search.
    await page.getByRole('radio', { name: 'Listă' }).click();
    await page.getByRole('searchbox').fill('sedinta foto');
    await expect(page.locator('.post-card')).toHaveCount(1);
    await expect(page.locator('.post-card')).toContainText('Lansare colecție de toamnă');
    await expectPhoneLayout(page);
  });

  test('media validation blocks "scheduled" but a draft still saves; caption over the limit', async ({ page }) => {
    await page.goto('/social?edit=new');
    const ed = editor(page);
    await ed.getByRole('combobox', { name: 'Platformă' }).selectOption({ label: 'TikTok' });
    await ed.getByRole('combobox', { name: 'Format', exact: true }).selectOption({ label: 'Feed Video (9:16)' });
    await ed.getByLabel('Titlu').fill('Video greșit');
    await ed.locator('#p-media-file').setInputFiles({ name: 'poza.png', mimeType: 'image/png', buffer: await png(1080, 1920) });
    await expect(ed.getByText(/Tip greșit: formatul cere video, fișierul este imagine/)).toBeVisible();
    // A wrong ratio on an image format is only a warning.
    await ed.getByRole('combobox', { name: 'Platformă' }).selectOption({ label: 'Instagram' });
    await ed.getByRole('combobox', { name: 'Format', exact: true }).selectOption({ label: 'Portrait Feed Post (4:5)' });
    await expect(ed.locator('.media-row')).toHaveAttribute('data-level', 'warning');
    await expect(ed.getByText('Raport 0.56, formatul cere 4:5.')).toBeVisible();
    await expect(ed.getByRole('button', { name: 'Decupează' })).toBeVisible();
    await ed.getByRole('combobox', { name: 'Platformă' }).selectOption({ label: 'TikTok' });
    await ed.getByRole('combobox', { name: 'Format', exact: true }).selectOption({ label: 'Feed Video (9:16)' });
    await ed.getByLabel('Text').fill('x'.repeat(2201));
    await expect(ed.getByText('Textul are 2201 caractere, limita este 2200.')).toBeVisible();
    await ed.getByRole('radio', { name: 'Programat' }).click();
    await expect(ed.getByText(/Remediază erorile de mai sus/)).toBeVisible();
    await ed.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(ed.getByText('Postarea nu poate fi programată încă')).toBeVisible();
    await ed.getByRole('radio', { name: 'Ciornă' }).click();
    await ed.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(page.getByText('Postarea a fost creată.')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Video greșit' }).locator('.status-badge')).toHaveText('Ciornă');
  });

  test('a past date is refused unless the post is published', async ({ page }) => {
    await page.goto('/social?edit=new');
    const ed = editor(page);
    await ed.getByLabel('Titlu').fill('Postare din trecut');
    await ed.getByLabel('Dată publicare').fill(dayFromToday(-3));
    await expect(ed.getByText('Doar postările publicate pot fi datate în trecut.')).toBeVisible();
    await ed.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(page.getByText('Postarea a fost creată.')).toBeHidden();
    await ed.getByRole('radio', { name: 'Publicat' }).click();
    await ed.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(page.getByText('Postarea a fost creată.')).toBeVisible();
  });

  test('duplicate as draft, edit, and delete from the detail', async ({ page }) => {
    await page.goto('/social?view=list');
    await page.locator('.post-card').first().getByRole('heading').getByRole('link').click();
    const detail = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Duplică ca ciornă' }) });
    const title = await detail.locator('h2, .dialog-title').first().textContent();
    await detail.getByRole('button', { name: 'Duplică ca ciornă' }).click();
    const ed = editor(page);
    await expect(ed.getByLabel('Titlu')).toHaveValue(/.+/);
    await expect(ed.getByRole('radio', { name: 'Ciornă' })).toHaveAttribute('aria-checked', 'true');
    await ed.getByLabel('Titlu').fill('Copie ciornă');
    await ed.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(page.getByText('Postarea a fost creată.')).toBeVisible();
    const copy = page.getByRole('dialog', { name: 'Copie ciornă' });
    await copy.getByRole('button', { name: 'Editează' }).click();
    await editor(page).getByLabel('Titlu').fill('Copie redenumită');
    await editor(page).getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(page.getByText('Postarea a fost salvată.')).toBeVisible();
    const renamed = page.getByRole('dialog', { name: 'Copie redenumită' });
    await renamed.getByRole('button', { name: 'Șterge' }).click();
    await page.getByRole('dialog', { name: 'Ștergi postarea?' }).getByRole('button', { name: 'Șterge' }).click();
    await expect(page.getByText('Postarea a fost ștearsă.')).toBeVisible();
    expect(title).toBeTruthy();
  });

  test('platform tabs filter; the year view opens the month on a day', async ({ page }) => {
    await page.goto('/social?view=list');
    await expect(page.locator('.post-card').first()).toBeVisible();
    const all = await page.locator('.post-card').count();
    expect(all).toBeGreaterThan(1);
    await page.getByRole('button', { name: /^TikTok/ }).click();
    await expect(page.locator('.post-card')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^TikTok/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('radio', { name: 'An' }).click();
    await expect(page.getByRole('heading', { name: '2026', exact: true })).toBeVisible();
    await page.locator(`.mini-day[data-date="${dayFromToday(1)}"]`).click();
    await expect(page.getByRole('radio', { name: 'Calendar' })).toHaveAttribute('aria-checked', 'true');
    await expectPhoneLayout(page);
  });

  test('platforms: add one, edit a format, disable it, and delete one with posts', async ({ page }) => {
    await page.goto('/social/platforms');
    await page.getByRole('button', { name: 'Adaugă platformă' }).click();
    const dlg = page.getByRole('dialog', { name: 'Adaugă platformă' });
    await dlg.getByLabel('Nume platformă').fill('Mastodon');
    await dlg.getByRole('textbox', { name: 'Culoare brand' }).fill('#6364ff');
    await dlg.getByLabel('Domeniu').fill('joinmastodon.org');
    await dlg.getByRole('button', { name: 'Salvează' }).click();
    const card = page.locator('.platform-card', { has: page.getByRole('heading', { name: 'Mastodon' }) });
    await expect(card).toBeVisible();
    await expect(card.locator('tbody tr')).toHaveCount(2);

    await card.getByRole('button', { name: 'Editează Postare imagine (4:5)' }).click();
    const fd = page.getByRole('dialog', { name: 'Editează Postare imagine (4:5)' });
    await fd.getByLabel('Limită text (caractere)').fill('500');
    await fd.getByLabel('Zonă sigură').fill('Margini de 60px');
    await fd.getByRole('button', { name: 'Salvează' }).click();
    await expect(card.locator('tbody tr').first()).toContainText('500');

    await card.getByRole('switch').click();
    await expect(page.getByText('Mastodon a fost dezactivată.', { exact: false })).toBeVisible();
    await page.goto('/social');
    await expect(page.locator('.platform-tab', { hasText: 'Mastodon' })).toHaveCount(0);

    // Reddit has a post: moving it requires typing the name.
    await page.goto('/social/platforms');
    const reddit = page.locator('.platform-card', { has: page.getByRole('heading', { name: 'Reddit' }) });
    await reddit.getByRole('button', { name: 'Șterge Reddit' }).click();
    const del = page.getByRole('dialog', { name: 'Ștergi platforma Reddit?' });
    await expect(del.getByText(/1 postare folosește/)).toBeVisible();
    await del.getByLabel('Platforma nouă').selectOption({ label: 'Facebook' });
    const go = del.getByRole('button', { name: 'Mută și șterge' });
    await expect(go).toBeDisabled();
    await del.getByLabel('Scrie „Reddit” pentru confirmare').fill('Reddit');
    await go.click();
    await expect(page.getByText('Platforma Reddit a fost ștearsă.')).toBeVisible();
    await expect(page.locator('.platform-card', { has: page.getByRole('heading', { name: 'Reddit' }) })).toHaveCount(0);
    await expectPhoneLayout(page);
  });

  test('import shows a preview and changes nothing until confirmed', async ({ page }) => {
    await page.goto('/social/platforms');
    // Export round-trip: the downloaded file imports as "no changes".
    await page.getByRole('button', { name: 'Mai multe' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Exportă JSON', exact: true }).click()]);
    expect(download.suggestedFilename()).toMatch(/^social-\d{4}-\d{2}-\d{2}\.json$/);
    await page.locator('input[type="file"][accept*="json"]').setInputFiles(await download.path());
    const same = page.getByRole('dialog', { name: 'Previzualizare import' });
    await expect(same.getByText('Fișierul este identic cu datele actuale.')).toBeVisible();
    await expect(same.getByRole('button', { name: 'Importă' })).toBeDisabled();
    await same.getByRole('button', { name: 'Anulează' }).click();

    const doc = (await apiInPage(page, 'GET', '/social/export')).data;
    doc.platforms[0].name = 'TikTok Studio';
    await page.locator('input[type="file"][accept*="json"]').setInputFiles({ name: 'social.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
    const prev = page.getByRole('dialog', { name: 'Previzualizare import' });
    await expect(prev.getByText('Platforme modificate: TikTok Studio')).toBeVisible();
    await prev.getByRole('button', { name: 'Anulează' }).click();
    await expect(page.getByRole('heading', { name: 'TikTok', exact: true })).toBeVisible();
    await page.locator('input[type="file"][accept*="json"]').setInputFiles({ name: 'social.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
    await page.getByRole('dialog', { name: 'Previzualizare import' }).getByRole('button', { name: 'Importă' }).click();
    await expect(page.getByText('Importul a fost aplicat.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'TikTok Studio' })).toBeVisible();
  });

  test('the standards matrix lists every format and filters by platform', async ({ page }) => {
    await page.goto('/social/standards');
    await expect(page.locator('.standards-table tbody tr')).toHaveCount(19);
    await page.getByLabel('Filtrează după platformă').selectOption({ label: 'YouTube' });
    const rows = page.locator('.standards-table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const r of await rows.all()) await expect(r).toContainText('YouTube');
    await expectPhoneLayout(page);
  });
});

test('non-admins cannot open the planner', async ({ page, request }) => {
  await ensureUser(request, 'e2e.soc.user', 'o parolă lungă și sigură', 'user');
  await signIn(page, 'e2e.soc.user', 'o parolă lungă și sigură');
  await expect(page).toHaveURL(/calendar/);
  await page.goto('/social');
  await expect(page.getByRole('heading', { name: /acces/i })).toBeVisible();
});
