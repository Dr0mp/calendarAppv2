import { test, expect } from '@playwright/test';
import { signIn, ensureUser, expectPhoneLayout } from './helpers.js';

const PW = 'o parolă lungă și sigură';

test.beforeEach(async ({ page, request }) => {
  await ensureUser(request, 'e2e.admin', PW, 'admin', { email: 'e2e.admin@casaartis.test', name: 'Admin E2E' });
  await signIn(page, 'e2e.admin', PW);
  await expect(page).toHaveURL(/\/calendar/);
});

test('invite a user from the admin page; they accept; edit, disable, enable, delete', async ({ page, browser }, info) => {
  const username = `nou.${info.project.name.replace(/[^a-z]/g, '')}`;
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Invită utilizator' }).click();
  const dlg = page.getByRole('dialog', { name: 'Invită utilizator' });
  await dlg.getByRole('textbox', { name: 'Nume', exact: true }).fill('Radu Nou');
  await dlg.getByLabel('Nume utilizator').fill(username);
  await dlg.getByLabel('Email').fill(`${username}@casaartis.test`);
  await dlg.getByLabel('Rol').selectOption('moderator');
  await dlg.getByRole('button', { name: 'Trimite invitația' }).click();
  await expect(page.getByText(`Invitația a fost trimisă la ${username}@casaartis.test.`)).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: `@${username}` });
  await expect(row.getByText('Invitat')).toBeVisible();

  // Copy a fresh link instead of emailing.
  await row.getByRole('button', { name: 'Mai multe acțiuni pentru Radu Nou' }).click();
  await page.getByRole('menuitem', { name: 'Copiază linkul de invitație' }).click();
  const linkDialog = page.getByRole('dialog', { name: 'Link de invitație' });
  const link = await linkDialog.getByRole('textbox').inputValue();
  expect(link).toMatch(/\/invite\//);
  await linkDialog.getByRole('button', { name: 'Închide' }).first().click();

  // The invitee accepts in another browser.
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(new URL(link).pathname);
  await p2.getByLabel('Parolă nouă').fill(PW);
  await p2.getByLabel('Repetați parola').fill(PW);
  await p2.getByRole('button', { name: 'Salvează parola' }).click();
  await p2.getByRole('button', { name: 'Mai târziu' }).click().catch(() => {});
  await expect(p2).toHaveURL(/\/calendar/);

  await page.reload();
  await expect(row.getByText('Activ', { exact: true })).toBeVisible();

  // Edit: role back to user.
  await row.getByRole('button', { name: 'Editează' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('Rol').selectOption('user');
  await edit.getByRole('button', { name: 'Salvează' }).click();
  await expect(page.getByText('Modificările au fost salvate.')).toBeVisible();
  await expect(row.getByText('Utilizator', { exact: true })).toBeVisible();
  // A role change signs the user out.
  await p2.goto('/account');
  await expect(p2.getByRole('heading', { name: 'Bine ați revenit' })).toBeVisible();

  // Disable, then enable.
  await row.getByRole('button', { name: 'Mai multe acțiuni pentru Radu Nou' }).click();
  await page.getByRole('menuitem', { name: 'Dezactivează' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Dezactivează' }).click();
  await expect(row.getByText('Dezactivat')).toBeVisible();
  await p2.getByLabel('Nume utilizator').fill(username);
  await p2.getByLabel('Parolă', { exact: true }).fill(PW);
  await p2.getByRole('button', { name: 'Autentificare', exact: true }).click();
  await expect(p2.getByRole('alert')).toBeVisible();
  await row.getByRole('button', { name: 'Mai multe acțiuni pentru Radu Nou' }).click();
  await page.getByRole('menuitem', { name: 'Activează' }).click();
  await expect(row.getByText('Activ', { exact: true })).toBeVisible();
  await ctx.close();

  // Delete (no upcoming entries, so no transfer needed).
  await row.getByRole('button', { name: 'Mai multe acțiuni pentru Radu Nou' }).click();
  await page.getByRole('menuitem', { name: 'Șterge' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Șterge utilizatorul' }).click();
  await expect(page.getByText('Utilizatorul a fost șters.')).toBeVisible();
  await expect(page.getByText(`@${username}`)).toHaveCount(0);
  await expectPhoneLayout(page);
});

test('spaces: add, edit, disable, delete', async ({ page }, info) => {
  const name = `Sala Test ${info.project.name}`;
  await page.goto('/admin/spaces');
  await page.getByRole('button', { name: 'Adaugă spațiu' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Salvează' }).click();
  await expect(dlg.getByText('Câmp obligatoriu.')).toBeVisible();
  await dlg.getByRole('textbox', { name: 'Nume', exact: true }).fill(name);
  await dlg.getByLabel('Capacitate (persoane)').fill('25');
  await dlg.getByRole('button', { name: 'Salvează' }).click();
  const item = page.locator('.sortable-item').filter({ hasText: name });
  await expect(item).toContainText('25 de locuri');
  await item.getByRole('button', { name: `Editează ${name}` }).click();
  await page.getByRole('dialog').getByLabel('Capacitate (persoane)').fill('30');
  await page.getByRole('dialog').getByRole('button', { name: 'Salvează' }).click();
  await expect(item).toContainText('30 de locuri');
  await item.getByRole('switch').click();
  await expect(item.getByText('Dezactivat')).toBeVisible();
  await item.getByRole('button', { name: `Mută mai sus: ${name}` }).click();
  await item.getByRole('button', { name: `Șterge ${name}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Șterge' }).click();
  await expect(page.getByText(`${name} a fost șters.`)).toBeVisible();
  await expectPhoneLayout(page);
});

test('a space with entries cannot be deleted', async ({ page }) => {
  await page.goto('/admin/spaces');
  const first = page.locator('.sortable-item').first();
  await first.getByRole('button', { name: /^Șterge / }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Șterge' }).click();
  await expect(page.getByText('Dezactivați spațiul sau mutați înregistrările.')).toBeVisible();
});

test('phone: the users table becomes cards; settings save', async ({ page, isMobile }) => {
  await page.goto('/admin/users');
  await expect(page.locator('.table')).toBeVisible();
  if (isMobile) await expect(page.locator('.table thead')).toBeHidden();
  else await expect(page.locator('.table thead')).toBeVisible();
  await expectPhoneLayout(page);

  await page.goto('/admin/settings');
  await page.getByLabel('Numele organizației').fill('Casa Artis');
  await page.locator('section').filter({ hasText: 'Organizație' }).getByRole('button', { name: 'Salvează' }).click();
  await expect(page.getByText('Modificările au fost salvate.')).toBeVisible();
  await expectPhoneLayout(page);
});

test('the style guide renders both themes', async ({ page }) => {
  await page.goto('/dev/styleguide');
  await expect(page.locator('.sg-theme[data-theme="light"]')).toBeVisible();
  await expect(page.locator('.sg-theme[data-theme="dark"]')).toBeVisible();
  // Tokens resolve differently in each scope.
  const [light, dark] = await page.$$eval('.sg-theme', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(light).not.toBe(dark);
});
