import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173/relaiapp/',
    screenshot: 'only-on-failure',
    // The fixture records and sanitizes traces before attaching them.
    trace: 'off',
  },
  // Full Chromium's new headless mode supports real tab activation; headless-shell
  // keeps every tab focused and cannot exercise this lifecycle regression.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
  webServer: {
    command: 'node --import tsx scripts/start-e2e.ts',
    url: 'http://127.0.0.1:4173/relaiapp/api/v1/health',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { CLOUDFLARE_ENV: '', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' },
  },
})
