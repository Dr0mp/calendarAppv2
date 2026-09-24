import sharp from 'sharp';
import { test, expect, signIn, ensureUser, apiInPage, dayFromToday, demoAdmin, expectPhoneLayout } from './helpers.js';

const PW = 'o parolă lungă și sigură';

/** A solid-colour PNG of the given size. @param {number} w @param {number} h */
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 120, b: 110 } } }).png().toBuffer();

test.beforeEach(async ({ request }) => {
  await ensureUser(request, 'e2e.media', PW, 'user', { name: 'Media E2E' });
});

test('cover: upload a square image, crop it to 16:9, then pick from the library', async ({ page }, info) => {
  await signIn(page, 'e2e.media', PW);
  await expect(page).toHaveURL(/calendar/);
  await page.goto('/schedule');

  // Upload a square image: the badge says it is the wrong shape.
  await page.locator('#f-cover-file').setInputFiles({ name: 'patrat.png', mimeType: 'image/png', buffer: await png(1200, 1200) });
  await expect(page.getByText('1200 × 1200 · Pătrat')).toBeVisible();
  await expect(page.getByRole('button', { name: /Salvează/ })).toBeDisabled();

  // Crop it: a new 16:9 media record replaces the cover.
  await page.getByRole('button', { name: 'Decupează la 16:9' }).click();
  const crop = page.getByRole('dialog', { name: 'Decupează la 16:9' });
  const frame = crop.getByRole('slider', { name: 'Cadru de decupare' });
  await expect(frame).toBeVisible();
  await frame.focus();
  await page.keyboard.press('ArrowDown');
  await crop.getByRole('button', { name: 'Decupează și folosește' }).click();
  await expect(crop).toBeHidden();
  await expect(page.getByText('1200 × 675 · 16:9')).toBeVisible();
  await expect(page.getByRole('button', { name: /Salvează/ })).toBeEnabled();

  // Remove it and pick the original 16:9 crop back from "my uploads".
  await page.getByRole('button', { name: 'Elimină' }).first().click();
  await expect(page.getByText('1200 × 675 · 16:9')).toBeHidden();
  await page.getByRole('button', { name: 'Din bibliotecă' }).click();
  const lib = page.getByRole('dialog', { name: 'Alege imaginea de copertă' });
  await expect(lib.locator('.media-tile')).toHaveCount(2);
  await lib.getByRole('button', { name: /patrat-16x9/ }).click();
  await expect(lib).toBeHidden();
  await expect(page.getByText('1200 × 675 · 16:9')).toBeVisible();
  await expectPhoneLayout(page);

  // Save an event with that cover; the detail shows it from /media.
  const spaces = await apiInPage(page, 'GET', '/spaces');
  await page.getByRole('textbox', { name: 'Titlu eveniment' }).fill('Eveniment cu copertă încărcată');
  await page.locator('#f-space_id').selectOption(spaces.data.items[0].id);
  await page.locator('.session-row input[type="date"]').first().fill(dayFromToday(info.project.name.includes('phone') ? 150 : 160));
  await page.getByRole('switch', { name: 'Gratuit' }).click();
  await page.getByRole('textbox', { name: 'Link înscriere' }).fill('https://example.com/inscriere');
  await page.getByRole('button', { name: 'Salvează evenimentul' }).click();
  await expect(page.getByText('Evenimentul a fost programat.')).toBeVisible();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('img[src^="/media/"]').first()).toBeVisible();
});

test('an unsupported file shows a clear error', async ({ page }) => {
  await signIn(page, 'e2e.media', PW);
  await expect(page).toHaveURL(/calendar/);
  await page.goto('/schedule');
  await page.locator('#f-cover-file').setInputFiles({ name: 'notite.txt', mimeType: 'text/plain', buffer: Buffer.from('nu e imagine') });
  await expect(page.getByText('Tipul acesta de fișier nu este acceptat.')).toBeVisible();
});

test('demo: "Folosește imagine exemplu" sets an uploaded 16:9 cover', async ({ page, request }) => {
  await demoAdmin(page, request);
  await page.goto('/schedule');
  await page.getByRole('button', { name: 'Folosește imagine exemplu' }).click();
  await expect(page.getByText(/× \d+ · 16:9/)).toBeVisible();
  await expect(page.locator('.cover-preview img')).toHaveAttribute('src', /^\/media\//);
});
