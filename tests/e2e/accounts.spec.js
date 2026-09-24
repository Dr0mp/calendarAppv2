import { test, expect, testApi, signIn, signOut, ensureUser, virtualAuthenticator, expectPhoneLayout } from './helpers.js';

const PW = 'o parolă lungă și sigură';

test('flow 1: accept the invitation, add a passkey, sign in with it', async ({ page, request, browserName }, info) => {
  const username = `invitat.${info.project.name.replace(/[^a-z]/g, '')}`;
  const { link } = await testApi(request, 'POST', 'invite', { username, name: 'Maria Invitată' });
  const passkeys = browserName === 'chromium';
  if (passkeys) await virtualAuthenticator(page);

  await page.goto(new URL(link).pathname);
  await expect(page.getByRole('heading', { name: 'Bun venit, Maria Invitată!' })).toBeVisible();
  await page.getByLabel('Parolă nouă').fill('prea scurt');
  await page.getByLabel('Repetați parola').fill('prea scurt');
  await page.getByRole('button', { name: 'Salvează parola' }).click();
  await expect(page.getByRole('alert')).toContainText('cel puțin 12');
  await page.getByLabel('Parolă nouă').fill(PW);
  await page.getByLabel('Repetați parola').fill(PW);
  await page.getByRole('button', { name: 'Salvează parola' }).click();

  if (passkeys) {
    await page.getByRole('button', { name: 'Adaugă cheie de acces' }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await page.goto('/account');
    await expect(page.locator('#passkeys .list-row')).toHaveCount(1);
    await signOut(page);
    await page.goto('/login');
    await page.getByRole('button', { name: 'Autentificare cu cheie de acces' }).click();
    await expect(page).toHaveURL(/\/(calendar|account)/);
    await page.goto('/account');
    await expect(page.getByText(`@${username}`)).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Mai târziu' }).click().catch(() => {});
    await expect(page).toHaveURL(/\/calendar/);
  }
  // The invitation link is single-use.
  await signOut(page);
  await page.goto(new URL(link).pathname);
  await expect(page.getByText('Linkul nu mai este valabil')).toBeVisible();
});

test('sign-in errors are generic and translated', async ({ page }) => {
  await signIn(page, 'nimeni', 'o parolă greșită oarecare');
  await expect(page.getByRole('alert')).toHaveText('Nume de utilizator sau parolă greșită.');
});

test('flow 2: forgot password, reset by email, old sessions revoked', async ({ page, browser, request }, info) => {
  const username = `uituc.${info.project.name.replace(/[^a-z]/g, '')}`;
  const email = `${username}@casaartis.test`;
  await ensureUser(request, username, PW, 'user', { email });

  // A signed-in session on another device.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, username, PW);
  await expect(otherPage).toHaveURL(/\/calendar/);

  const before = (await testApi(request, 'GET', 'outbox')).items.length;
  await page.goto('/forgot');
  await page.getByLabel('Nume utilizator sau email').fill('nu-exista');
  await page.getByRole('button', { name: 'Trimite linkul' }).click();
  await expect(page.getByText('Dacă există un cont, veți primi un email.')).toBeVisible();
  expect((await testApi(request, 'GET', 'outbox')).items.length).toBe(before);

  await page.goto('/forgot');
  await page.getByLabel('Nume utilizator sau email').fill(email);
  await page.getByRole('button', { name: 'Trimite linkul' }).click();
  await expect(page.getByText('Dacă există un cont, veți primi un email.')).toBeVisible();
  const mail = (await testApi(request, 'GET', 'outbox')).items.at(-1);
  expect(mail.to).toBe(email);
  const resetPath = new URL(mail.text.match(/https?:\/\/\S+\/reset\/\S+/)[0]).pathname;

  const NEW = 'o altă parolă foarte sigură';
  await page.goto(resetPath);
  await page.getByLabel('Parolă nouă').fill(NEW);
  await page.getByLabel('Repetați parola').fill(NEW);
  await page.getByRole('button', { name: 'Salvează parola' }).click();
  await expect(page).toHaveURL(/\/calendar/);

  // The other device was signed out.
  await otherPage.goto('/account');
  await expect(otherPage.getByRole('heading', { name: 'Bine ați revenit' })).toBeVisible();
  await other.close();

  // The new password works; the old one doesn't.
  await signOut(page);
  await signIn(page, username, PW);
  await expect(page.getByRole('alert')).toBeVisible();
  await signIn(page, username, NEW);
  await expect(page).toHaveURL(/\/calendar/);
});

test('demo sign-in lands in the demo workspace with a banner', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Demo Utilizator' }).click();
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole('note')).toHaveText(/Mod demonstrativ/);
  await expectPhoneLayout(page);
});

test('a user reaching an admin page sees "not allowed", not the sign-in page', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Demo Utilizator' }).click();
  await expect(page).toHaveURL(/\/calendar/);
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Nu aveți acces la această pagină' })).toBeVisible();
});

test('a deep link survives sign-in', async ({ page, request }) => {
  await ensureUser(request, 'deeplink', PW);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Bine ați revenit' })).toBeVisible();
  await page.getByLabel('Nume utilizator').fill('deeplink');
  await page.getByLabel('Parolă', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Autentificare', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
});
