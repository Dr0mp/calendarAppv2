import { test, expect, signIn, ensureUser, apiInPage, dayFromToday, expectPhoneLayout } from './helpers.js';

const PW = 'o parolă lungă și sigură';

test.beforeEach(async ({ page, request }) => {
  await ensureUser(request, 'e2e.admin', PW, 'admin', { email: 'e2e.admin@casaartis.test', name: 'Admin E2E' });
  await signIn(page, 'e2e.admin', PW);
  await expect(page).toHaveURL(/\/calendar/);
});

/** Select every row (phones have no header checkbox: tables become cards). @param {import('@playwright/test').Page} page */
async function selectAll(page) {
  const all = page.getByRole('checkbox', { name: 'Selectează tot' });
  if (await all.isVisible()) return all.check();
  for (const c of await page.getByRole('checkbox', { name: 'Selectează', exact: true }).all()) await c.check();
}

/** @param {import('@playwright/test').Page} page @param {string} title @param {number} offset */
async function blocked(page, title, offset) {
  const r = await apiInPage(page, 'POST', '/entries', { entry: { type: 'blocked', title, sessions: [{ date: dayFromToday(offset), start: '07:00', end: '07:30' }] } });
  expect(r.status).toBe(201);
  return r.data;
}

test('flow 9: delete a user with upcoming entries, transferring them', async ({ page, browser, request }, info) => {
  const username = `e2e.pleaca.${info.project.name.replace(/[^a-z]/g, '')}`;
  await ensureUser(request, username, PW, 'user', { name: `Pleacă ${info.project.name}` });
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.clock.install({ time: Date.parse('2026-09-24T07:00:00Z') });
  await signIn(p2, username, PW);
  await expect(p2).toHaveURL(/calendar/);
  const title = `Transfer ${info.project.name}`;
  await blocked(p2, title, info.project.name.includes('phone') ? 141 : 140);
  await ctx.close();

  await page.goto('/admin/users');
  const row = page.getByRole('row', { name: new RegExp(`Pleacă ${info.project.name}`) });
  await row.getByRole('button', { name: /Mai multe acțiuni/ }).click();
  await page.getByRole('menuitem', { name: 'Șterge' }).click();
  const dlg = page.getByRole('dialog', { name: /Ștergeți contul/ });
  const go = dlg.getByRole('button', { name: 'Șterge utilizatorul' });
  await expect(go).toBeDisabled();
  await dlg.getByLabel(/Transferă înregistrările/).selectOption({ label: 'Admin E2E (@e2e.admin)' });
  await go.click();
  await expect(page.getByText('Utilizatorul a fost șters.')).toBeVisible();

  // The audit page shows the entry with its new owner.
  await page.goto(`/admin/entries?q=${encodeURIComponent(title)}`);
  const entryRow = page.getByRole('row', { name: new RegExp(title) });
  await expect(entryRow).toContainText('Admin E2E');
});

test('flow 9: storage cleanup preview and run', async ({ page }) => {
  await page.goto('/admin/storage');
  // An unused upload to purge.
  const status = await page.evaluate(async () => {
    const s = await (await fetch('/api/v1/session')).json();
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    ctx.fillStyle = `hsl(${Math.random() * 360} 70% 50%)`;
    ctx.fillRect(0, 0, 64, 64);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const res = await fetch('/api/v1/media', { method: 'POST', headers: { 'X-CSRF-Token': s.csrfToken, 'Content-Type': 'application/octet-stream', 'X-Filename': 'nefolosit.png' }, body: blob });
    return res.status;
  });
  expect(status).toBe(201);
  await page.reload();
  const tool = page.getByRole('group', { name: 'Șterge acum fișierele nefolosite' });
  await expect(tool.getByRole('button', { name: 'Rulează' })).toBeDisabled();
  await tool.getByRole('button', { name: 'Previzualizează' }).click();
  await expect(tool.getByRole('status')).toContainText(/Previzualizare: \d+ elemente, .+ de eliberat\./);
  await tool.getByRole('button', { name: 'Rulează' }).click();
  await page.getByRole('dialog', { name: 'Șterge acum fișierele nefolosite' }).getByRole('button', { name: 'Rulează' }).click();
  await expect(page.getByText(/Curățare terminată: \d+ elemente/)).toBeVisible();
  await tool.getByRole('button', { name: 'Previzualizează' }).click();
  await expect(tool.getByRole('status')).toHaveText('Nimic de curățat.');
  await expectPhoneLayout(page);
});

test('all entries: filters, bulk reassign, bulk delete and CSV export', async ({ page, request }, info) => {
  await ensureUser(request, 'e2e.bulk.target', PW, 'user', { name: 'Țintă Bulk' });
  const tag = `Bulk ${info.project.name}`;
  const base = info.project.name.includes('phone') ? 150 : 145;
  await blocked(page, `${tag} A`, base);
  await blocked(page, `${tag} B`, base + 1);
  await page.goto(`/admin/entries?q=${encodeURIComponent(tag)}`);
  await expect(page.getByRole('row', { name: new RegExp(tag) })).toHaveCount(2);
  await selectAll(page);
  await expect(page.getByText('2 selectate')).toBeVisible();
  await page.getByRole('region', { name: 'Acțiuni pe selecție' }).getByRole('button', { name: 'Reatribuie' }).click();
  const dlg = page.getByRole('dialog', { name: 'Reatribuie 2 înregistrări' });
  await dlg.getByLabel('Proprietar nou').selectOption({ label: 'Țintă Bulk' });
  await dlg.getByRole('button', { name: 'Reatribuie' }).click();
  await expect(page.getByText('2 înregistrări reatribuite.')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`${tag} A`) })).toContainText('Țintă Bulk');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Exportă CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const csv = await (await import('node:fs')).promises.readFile(await download.path(), 'utf8');
  expect(csv.split('\r\n').filter((l) => l.includes(tag))).toHaveLength(2);

  await selectAll(page);
  await page.getByRole('region', { name: 'Acțiuni pe selecție' }).getByRole('button', { name: 'Șterge' }).click();
  await page.getByRole('dialog', { name: /Ștergi cele 2 înregistrări/ }).getByRole('button', { name: 'Șterge' }).click();
  await expect(page.getByText('2 înregistrări șterse.')).toBeVisible();
  await expect(page.getByText('Nicio înregistrare')).toBeVisible();
  await expectPhoneLayout(page);
});

test('settings: download a backup', async ({ page }) => {
  await page.goto('/admin/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Descarcă backup' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^backup-[\d-]+\.zip$/);
  const buf = await (await import('node:fs')).promises.readFile(await download.path());
  expect(buf.readUInt32LE(0)).toBe(0x04034b50);
});
