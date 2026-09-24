import { expect } from '@playwright/test';

export const TOKEN = 'e2e-token';
export const BASE = `http://localhost:${process.env.E2E_PORT ?? 3210}`;

/** Call a test-only endpoint. @param {import('@playwright/test').APIRequestContext} request @param {string} method @param {string} path */
export async function testApi(request, method, path, data) {
  const res = await request.fetch(`/api/v1/test/${path}`, {
    method,
    headers: { 'test-reset-token': TOKEN, origin: BASE },
    data,
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/** Sign in through the form. @param {import('@playwright/test').Page} page */
export async function signIn(page, username, password) {
  await page.goto('/login');
  await page.getByLabel('Nume utilizator').fill(username);
  await page.getByLabel('Parolă', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Autentificare', exact: true }).click();
}

/** Add a Chromium virtual authenticator (passkeys). @param {import('@playwright/test').Page} page */
export async function virtualAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

/** No horizontal overflow and the tab bar stays on screen (phones). @param {import('@playwright/test').Page} page */
export async function expectPhoneLayout(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const bar = page.locator('.tabbar');
  if (await bar.isVisible()) {
    const box = await bar.boundingBox();
    const vh = page.viewportSize()?.height ?? 0;
    expect(box && box.y + box.height).toBeLessThanOrEqual(vh + 1);
  }
}

/** Sign out from inside the page (sends the CSRF token like the app does). @param {import('@playwright/test').Page} page */
export async function signOut(page) {
  await page.evaluate(async () => {
    const s = await (await fetch('/api/v1/session')).json();
    await fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': s.csrfToken ?? '' } });
  });
}

/** Ensure an active account exists. @param {import('@playwright/test').APIRequestContext} request */
export const ensureUser = (request, username, password, role = 'user', extra = {}) =>
  testApi(request, 'POST', 'user', { username, password, role, ...extra });

/** Call the API from inside the page (same cookies, CSRF header). @param {import('@playwright/test').Page} page */
export async function apiInPage(page, method, path, body, version) {
  return page.evaluate(
    async ({ method, path, body, version }) => {
      const s = await (await fetch('/api/v1/session')).json();
      /** @type {Record<string,string>} */ const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrfToken ?? '' };
      if (version !== undefined) headers['If-Match'] = `W/"${version}"`;
      const r = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, data: await r.json().catch(() => null) };
    },
    { method, path, body, version },
  );
}

/** Serve fake https cover images from the sample file (tests run offline). @param {import('@playwright/test').Page} page */
export async function fakeImages(page) {
  await page.route('https://img.test/**', (route) => route.fulfill({ path: 'public/sample/cover-16x9.webp', contentType: 'image/webp' }));
}

/** YYYY-MM-DD `n` days from today in Bucharest. @param {number} n */
export function dayFromToday(n) {
  const now = new Date(Date.now() + n * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(now);
}
