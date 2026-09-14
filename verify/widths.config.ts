import { defineConfig, devices } from '@playwright/test'

/**
 * The six widths the iPad can be, checked against the built export.
 *
 * Separate from `playwright.config.ts` on purpose: those flows need a server
 * with the thirteen-song library, and this needs nothing but
 * `npm run export:web --workspace @selfmp3/app`. It serves the export itself
 * and never signs in, so what it can prove is narrower — that the app draws,
 * and that nothing spills sideways — but it proves it anywhere, including in
 * CI and in a container, which is where the layout regressions that matter
 * would otherwise go unnoticed until someone picked up an iPad.
 */
const executablePath = process.env['PLAYWRIGHT_CHROMIUM_PATH']

export default defineConfig({
  testDir: '.',
  testMatch: /widths\.spec\.ts$/,
  workers: 1,
  reporter: [['list']],
  webServer: {
    // Relative to this config's directory, which Playwright makes the cwd.
    command: 'node serveExport.mjs',
    url: 'http://127.0.0.1:4699/index.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4699',
    ...devices['Desktop Chrome'],
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
})
