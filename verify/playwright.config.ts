import { defineConfig, devices } from '@playwright/test'

/**
 * The browser, where the environment has one that is not the pinned build.
 *
 * A cloud container ships a Chromium and sets `PLAYWRIGHT_BROWSERS_PATH`, but
 * its build number rarely matches what this Playwright pinned, and Playwright
 * would rather download than use it. On a Mac with `npx playwright install`
 * done, none of this applies and the variable is unset.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH

/**
 * Two widths, because the app has two layouts and the plan checks both.
 *
 * 1280 is the desktop layout — sidebar, player bar. 375 is the phone layout,
 * which is also the reference for the phone app: `apps/mobile` was built to
 * this CSS in the first place, so a flow that passes here is the flow the
 * simulator is checked against.
 */
export default defineConfig({
  testDir: '.',
  // The app talks to a real server; these are not parallel-safe against one
  // library, since they love songs and edit playlists.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.SELFMP3_WEB_URL ?? 'http://localhost:4601',
    trace: 'retain-on-failure',
    // A sleeping Mac is the usual cause of a slow first paint; this is not the
    // thing under test.
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
})
