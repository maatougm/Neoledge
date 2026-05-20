import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for NeoLeadge frontend E2E.
 *
 *   E2E_BASE_URL  override the target host (default = live test server)
 *   E2E_HEADED=1  open a real browser window (useful for debugging)
 *
 * Run a single spec:   npx playwright test e2e/auth.spec.ts
 * Open UI mode:        npm run test:e2e:ui
 * Open last report:    npx playwright show-report
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,            // many specs touch shared admin data — keep ordering
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://neoleadge.pythagore-init.com',
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  outputDir: 'test-results',
})
