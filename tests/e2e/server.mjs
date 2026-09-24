// Test server for Playwright: a fresh DATA_DIR, the test SMTP sink and the
// test-only endpoints (guarded by TEST_RESET_TOKEN).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-e2e-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATA_DIR: dir,
  ASSETS: process.env.ASSETS ?? 'local',
  SMTP_URL: 'test://outbox',
  HIBP_CHECK: '0',
  LOG_LEVEL: 'warn',
  TEST_RESET_TOKEN: 'e2e-token',
});
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
await import('../../server/index.js');
