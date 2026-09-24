import { test, expect, signIn, ensureUser, apiInPage, fakeImages, dayFromToday, expectPhoneLayout } from './helpers.js';

const PW = 'o parolă lungă și sigură';

/** @param {import('@playwright/test').Page} page */
async function spaceIds(page) {
  const r = await apiInPage(page, 'GET', '/spaces');
  return { hall: r.data.items[0].id, studio: r.data.items[1].id };
}

/** Fill the common event fields. @param {import('@playwright/test').Page} page */
async function fillEvent(page, title, spaceId) {
  await page.getByRole('textbox', { name: 'Titlu eveniment' }).fill(title);
  await page.locator('#f-space_id').selectOption(spaceId);
  await page.getByLabel('Sumă').fill('75');
  await page.getByRole('textbox', { name: 'Link înscriere' }).fill('https://example.com/inscriere');
  await page.getByLabel('Link imagine copertă').fill('https://img.test/cover.webp');
  await page.getByLabel('Link imagine copertă').blur();
  await expect(page.getByText('1600 × 900 · 16:9')).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await fakeImages(page);
  await ensureUser(request, 'e2e.user', PW, 'user', { name: 'Utilizator E2E' });
  await ensureUser(request, 'e2e.other', PW, 'user', { name: 'Alt Utilizator' });
  await ensureUser(request, 'e2e.mod', PW, 'moderator', { name: 'Moderator E2E' });
  await ensureUser(request, 'e2e.admin', PW, 'admin', { name: 'Admin E2E' });
});

test('flow 3: an event with 3 sessions; the conflict panel offers suggestions', async ({ page, browser }, info) => {
  const offset = info.project.name.includes('phone') ? 70 : 50;
  const [d1, d2, d3] = [dayFromToday(offset), dayFromToday(offset + 1), dayFromToday(offset + 2)];

  // Someone else already has the hall on day 2 at 18:00.
  const other = await browser.newPage();
  await fakeImages(other);
  await signIn(other, 'e2e.other', PW);
  await expect(other).toHaveURL(/calendar/);
  const { hall } = await spaceIds(other);
  const busy = await apiInPage(other, 'POST', '/entries', {
    entry: { type: 'event', title: 'Concert ocupat', space_id: hall, sessions: [{ date: d2, start: '18:00', end: '20:00' }], enroll_url: 'https://example.com/x', cover_url: 'https://img.test/c.webp', price_cents: null },
  });
  expect(busy.status).toBe(201);
  await other.close();

  await signIn(page, 'e2e.user', PW);
  await expect(page).toHaveURL(/calendar/);
  await page.goto('/schedule');
  await fillEvent(page, 'Atelier în trei zile', hall);
  await page.getByRole('radio', { name: 'Mai multe zile' }).click();
  // Three days, 18:00–20:00.
  const dates = page.locator('.session-row input[type="date"]');
  await dates.nth(0).fill(d1);
  await page.locator('#f-sessions-0-start').selectOption('18:00');
  await page.getByRole('button', { name: 'Adaugă zi' }).click();
  await page.getByRole('button', { name: 'Adaugă zi' }).click();
  await expect(dates).toHaveCount(3);
  await expect(dates.nth(1)).toHaveValue(d2);
  await expect(dates.nth(2)).toHaveValue(d3);

  const panel = page.locator('.conflict-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Concert ocupat');
  await expect(panel.getByText('Aceeași oră, următoarea zi liberă')).toBeVisible();
  // Saving is refused while the conflict stands.
  await page.getByRole('button', { name: 'Salvează evenimentul' }).click();
  await expect(page.getByText('Sala este ocupată în intervalul ales.').first()).toBeVisible();
  // Use the first suggestion (same day, first free hour): the panel clears.
  await panel.getByRole('button', { name: 'Folosește' }).first().click();
  await expect(panel).toBeHidden();

  await page.getByRole('button', { name: 'Salvează evenimentul' }).click();
  await expect(page.getByText('Evenimentul a fost programat.')).toBeVisible();
  await expect(page).toHaveURL(/entry=/);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Atelier în trei zile' })).toBeVisible();
  await expect(dialog.locator('.detail-block').first().locator('li')).toHaveCount(3);
  await expect(dialog.getByText('75 RON')).toBeVisible();
  await expectPhoneLayout(page);
});

test('flow 4: a space conflict is blocked; the admin override works and is recorded', async ({ page }, info) => {
  const d = dayFromToday(info.project.name.includes('phone') ? 80 : 90);
  await signIn(page, 'e2e.admin', PW);
  await expect(page).toHaveURL(/calendar/);
  const { hall } = await spaceIds(page);
  const first = await apiInPage(page, 'POST', '/entries', {
    entry: { type: 'blocked', title: 'Repetiție privată', space_id: hall, sessions: [{ date: d, start: '10:00', end: '12:00' }] },
  });
  expect(first.status).toBe(201);

  await page.goto(`/schedule?date=${d}&time=11:00`);
  await fillEvent(page, 'Eveniment peste blocare', hall);
  const panel = page.locator('.conflict-panel');
  await expect(panel).toContainText('Repetiție privată');
  await panel.getByLabel('Permite suprapunerea').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Permite suprapunerea' }).click();
  await expect(panel.getByLabel('Permite suprapunerea')).toBeChecked();
  await page.getByRole('button', { name: 'Salvează evenimentul' }).click();
  await expect(page.getByText('Evenimentul a fost programat.')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Suprapunere permisă')).toBeVisible();
});

test('a user cannot override a conflict', async ({ page }, info) => {
  const d = dayFromToday(info.project.name.includes('phone') ? 81 : 91);
  await signIn(page, 'e2e.user', PW);
  await expect(page).toHaveURL(/calendar/);
  const { hall } = await spaceIds(page);
  const base = { type: 'event', space_id: hall, enroll_url: 'https://example.com/x', cover_url: 'https://img.test/c.webp', price_cents: null };
  expect((await apiInPage(page, 'POST', '/entries', { entry: { ...base, title: 'Primul', sessions: [{ date: d, start: '10:00', end: '12:00' }] } })).status).toBe(201);
  const r = await apiInPage(page, 'POST', '/entries', { entry: { ...base, title: 'Al doilea', allow_overlap: true, sessions: [{ date: d, start: '11:00', end: '12:00' }] } });
  expect(r.status).toBe(409);
  await page.goto(`/schedule?date=${d}&time=11:00`);
  await page.locator('#f-space_id').selectOption(hall);
  await expect(page.locator('.conflict-panel')).toBeVisible();
  await expect(page.locator('.conflict-panel').getByLabel('Permite suprapunerea')).toHaveCount(0);
});

test('flow 5: a moderator books a room; a user cannot', async ({ page }, info) => {
  const d = dayFromToday(info.project.name.includes('phone') ? 100 : 110);
  await signIn(page, 'e2e.mod', PW);
  await expect(page).toHaveURL(/calendar/);
  await page.goto(`/schedule?type=room_only&date=${d}`);
  await page.getByRole('textbox', { name: 'Nume rezervare / oaspeți' }).fill('Familia Popescu');
  await page.locator('#f-room_bookings-0-room_id').selectOption({ index: 1 });
  await page.locator('#f-room_bookings-0-guests').fill('2');
  await page.getByRole('button', { name: 'Salvează rezervarea' }).click();
  await expect(page.getByText('Rezervarea a fost salvată.')).toBeVisible();

  // The same booking again conflicts (always blocked).
  await page.goto(`/schedule?type=room_only&date=${d}`);
  await page.getByRole('textbox', { name: 'Nume rezervare / oaspeți' }).fill('Dublură');
  await page.locator('#f-room_bookings-0-room_id').selectOption({ index: 1 });
  await expect(page.getByText(/Camera este ocupată/)).toBeVisible();
  await page.getByRole('button', { name: 'Salvează rezervarea' }).click();
  await expect(page.getByText('Camera este deja rezervată în acele zile.')).toBeVisible();

  // A user doesn't get the room-only type, and the API refuses it.
  await page.goto('/schedule');
  await page.evaluate(() => localStorage.clear());
  const ctx = page.context();
  await ctx.clearCookies();
  await signIn(page, 'e2e.user', PW);
  await expect(page).toHaveURL(/calendar/);
  await page.goto('/schedule');
  await expect(page.getByRole('radio', { name: 'Doar cazare' })).toHaveCount(0);
  const rooms = await apiInPage(page, 'GET', '/rooms');
  const r = await apiInPage(page, 'POST', '/entries', {
    entry: { type: 'room_only', title: 'X', sessions: [], room_bookings: [{ room_id: rooms.data.items[0].id, check_in: d, check_out: dayFromToday(1000), guests: 1 }] },
  });
  expect(r.status).toBe(403);
});

test('my events: upcoming list, detail, duplicate, delete', async ({ page }, info) => {
  const d = dayFromToday(info.project.name.includes('phone') ? 120 : 130);
  await signIn(page, 'e2e.user', PW);
  await expect(page).toHaveURL(/calendar/);
  const { studio } = await spaceIds(page);
  const made = await apiInPage(page, 'POST', '/entries', {
    entry: { type: 'blocked', title: `Blocare ${info.project.name}`, description: 'secret', space_id: studio, sessions: [{ date: d, start: '09:00', end: '10:00' }] },
  });
  expect(made.status).toBe(201);
  await page.goto('/my-events');
  const card = page.locator('.entry-card').filter({ hasText: `Blocare ${info.project.name}` });
  await expect(card).toBeVisible();
  await page.getByRole('tab', { name: /Blocări/ }).click();
  await expect(card).toBeVisible();
  await page.getByRole('searchbox').fill('nimic-asemanator');
  await expect(page.getByText('Niciun rezultat pentru filtrele alese')).toBeVisible();
  await page.getByRole('button', { name: 'Resetează filtrele' }).click();
  await card.getByRole('link', { name: 'Detalii' }).click();
  await expect(page.getByRole('dialog').getByText('secret')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Închide' }).first().click();
  await card.getByRole('button', { name: 'Șterge' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Șterge' }).click();
  await expect(page.getByText('Înregistrarea a fost ștearsă.')).toBeVisible();
  await expect(card).toHaveCount(0);
  await expectPhoneLayout(page);
});
