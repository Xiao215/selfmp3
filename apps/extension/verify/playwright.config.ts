import { defineConfig } from '@playwright/test'

/**
 * The extension's end-to-end specs.
 *
 * They drive the built extension (`npm run build:extension` first) in
 * Playwright's Chromium, against a fake server started by each spec file, so
 * nothing here needs a real server, yt-dlp or YouTube.
 *
 * One worker: each spec file launches its own browser with the extension in it.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
})
