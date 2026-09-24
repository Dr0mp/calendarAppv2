import { test, expect, signIn, ensureUser, apiInPage, fakeImages, dayFromToday } from './helpers.js';

const PW = 'o parolă lungă și sigură';

/** A weekday-aligned date `weeks` weeks out (Mondays keep the arithmetic simple). */
function monday(weeksOut) {
  for (let i = 0; i < 7; i++) {
    const d = dayFromToday(weeksOut * 7 + i);
    if (new Date(`${d}T12:00:00Z`).getUTCDay() === 1) return d;
  }
  return dayFromToday(weeksOut * 7);
}

test.beforeEach(async ({ page, request }) => {
  await fakeImages(page);
  await ensureUser(request, 'e2e.series', PW, 'user', { name: 'Serii E2E' });
  await signIn(page, 'e2e.series', PW);
  await expect(page).toHaveURL(/calendar/);
});

test('flow 3 with recurrence: 3 sessions, monthly; conflict, suggestion, preview skip', async ({ page }, info) => {
  const phone = info.project.name.includes('phone');
  // Far apart so the desktop run's monthly occurrences never land on the phone run's day.
  const d = monday(phone ? 34 : 26);
  const spaces = (await apiInPage(page, 'GET', '/spaces')).data.items;
  const hall = spaces[0].id;
  // Something already booked in the hall on the first day at 14:00.
  const r = await apiInPage(page, 'POST', '/entries', {
    entry: { type: 'blocked', title: 'Repetiție cor', space_id: hall, sessions: [{ date: d, start: '14:00', end: '15:00' }] },
  });
  expect(r.status).toBe(201);

  await page.goto(`/schedule?date=${d}&time=10:00`);
  await page.getByRole('textbox', { name: 'Titlu eveniment' }).fill('Atelier lunar');
  await page.locator('#f-space_id').selectOption(hall);
  await page.getByRole('radio', { name: 'Mai multe sesiuni în aceeași zi' }).click();
  await page.locator('#f-sessions-0-start').selectOption('10:00');
  await page.getByRole('button', { name: 'Adaugă interval' }).click();
  await page.getByRole('button', { name: 'Adaugă interval' }).click();
  await expect(page.locator('.session-row')).toHaveCount(3);
  // Rows: 10–12, 13–15 (conflicts with 14:00), 16–18.
  await expect(page.locator('#f-sessions-1-start')).toHaveValue('13:00');
  const panel = page.locator('.conflict-panel');
  await expect(panel).toContainText('Repetiție cor');
  await panel.getByRole('button', { name: 'Folosește' }).first().click();
  await expect(panel).toBeHidden();

  await page.locator('#f-recurrence').selectOption('monthly_weekday');
  await page.getByLabel('Număr de apariții').fill('3');
  const occ = page.locator('.occurrence-list .occurrence');
  await expect(occ).toHaveCount(3);
  await expect(page.getByText(/3 sesiuni:/)).toBeVisible();
  // Skip the last date, then bring it back.
  await occ.nth(2).click();
  await expect(page.getByText(/2 sesiuni:/)).toBeVisible();
  await occ.nth(2).click();
  await expect(page.getByText(/3 sesiuni:/)).toBeVisible();

  await page.getByLabel('Sumă').fill('50');
  await page.getByRole('textbox', { name: 'Link înscriere' }).fill('https://example.com/lunar');
  await page.getByLabel('Link imagine copertă').fill('https://img.test/cover.webp');
  await page.getByLabel('Link imagine copertă').blur();
  await expect(page.getByText('1600 × 900 · 16:9')).toBeVisible();
  await page.getByRole('button', { name: 'Salvează evenimentul' }).click();
  await expect(page.getByText('3 sesiuni programate.')).toBeVisible();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Seria:' });
  await expect(dialog.getByText('Seria: lunar, 1 din 3')).toBeVisible();
  await dialog.getByRole('button', { name: 'Vezi toate sesiunile seriei' }).click();
  await expect(dialog.locator('.occurrence-list a')).toHaveCount(3);
});

test('flow 6: edit a series with each scope', async ({ page }, info) => {
  const phone = info.project.name.includes('phone');
  const d = monday(phone ? 40 : 36);
  const made = await apiInPage(page, 'POST', '/entries', {
    entry: { type: 'blocked', title: 'Curs', space_id: null, sessions: [{ date: d, start: '18:00', end: '19:00' }] },
    recurrence: { rule: { freq: 'weekly', count: 4 }, exceptions: [] },
  });
  expect(made.status).toBe(201);
  const series = (await apiInPage(page, 'GET', `/series/${made.data.series_id}`)).data.occurrences;

  /** Open an occurrence's edit form, change the title, save with a scope. */
  async function editWithScope(entryId, title, scopeLabel) {
    await page.goto(`/entries/${entryId}/edit`);
    await expect(page.getByText('Această sesiune face parte dintr-o serie.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Motiv blocare' }).fill(title);
    await page.getByRole('button', { name: 'Confirmă blocarea' }).click();
    const dlg = page.getByRole('dialog', { name: 'Această sesiune face parte dintr-o serie' });
    await dlg.getByRole('radio', { name: scopeLabel }).check();
    await dlg.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByText('Modificările au fost salvate.')).toBeVisible();
  }
  const titles = async () =>
    Promise.all(series.map(async (/** @type {any} */ o) => (await apiInPage(page, 'GET', `/entries/${o.id}`)).data.title));

  // Cancel really cancels.
  await page.goto(`/entries/${series[0].id}/edit`);
  await page.getByRole('textbox', { name: 'Motiv blocare' }).fill('Nu salva');
  await page.getByRole('button', { name: 'Confirmă blocarea' }).click();
  await page.getByRole('dialog', { name: 'Această sesiune face parte dintr-o serie' }).getByRole('button', { name: 'Anulează' }).click();
  expect(await titles()).toEqual(['Curs', 'Curs', 'Curs', 'Curs']);

  await editWithScope(series[1].id, 'Doar a doua', 'Doar această sesiune');
  expect(await titles()).toEqual(['Curs', 'Doar a doua', 'Curs', 'Curs']);

  await editWithScope(series[2].id, 'De acum', 'Aceasta și următoarele');
  expect(await titles()).toEqual(['Curs', 'Doar a doua', 'De acum', 'De acum']);

  await editWithScope(series[0].id, 'Toată seria', 'Toată seria');
  const after = await titles();
  expect(after[0]).toBe('Toată seria');
  expect(after[1]).toBe('Doar a doua');

  // Delete the whole (remaining) series from the detail panel.
  await page.goto(`/my-events?entry=${series[0].id}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Șterge' }).click();
  const del = page.getByRole('dialog', { name: /Ștergeți/ });
  await del.getByRole('radio', { name: 'Toată seria' }).check();
  await del.getByRole('button', { name: 'Șterge' }).click();
  await expect(page.getByText(/sesiuni șterse|O sesiune ștearsă|Înregistrarea a fost ștearsă/)).toBeVisible();
  expect((await apiInPage(page, 'GET', `/entries/${series[0].id}`)).status).toBe(404);
});
