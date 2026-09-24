import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE = `http://localhost:${PORT}`;
// CI runs every browser; locally E2E_BROWSERS=chromium keeps it quick.
const browsers = (process.env.E2E_BROWSERS ?? 'chromium,webkit,firefox').split(',');
const executablePath = process.env.CHROMIUM_PATH || undefined;

const sizes = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};
const engines = {
  chromium: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
  webkit: devices['Desktop Safari'],
  firefox: devices['Desktop Firefox'],
};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE,
    timezoneId: 'Europe/Bucharest',
    locale: 'ro-RO',
    trace: 'retain-on-failure',
  },
  projects: browsers.flatMap((b) =>
    Object.entries(sizes).map(([size, s]) => ({
      name: `${b}-${size}`,
      use: { ...engines[b], ...s, ...(b === 'firefox' ? { isMobile: undefined } : {}) },
    })),
  ),
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: `${BASE}/api/v1/health`,
    reuseExistingServer: false,
    env: { APP_URL: BASE, PORT: String(PORT) },
    timeout: 30_000,
  },
});
