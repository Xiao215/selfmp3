import { defineConfig, devices } from '@playwright/test'

import { appApi, FLOW_DEVICE_IDS, webUrl } from './env.js'

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
 * The app keeps its server's address through the `secrets` port, which in a
 * browser is `localStorage`; a fresh Playwright context has none, so without
 * this seed the app quite correctly shows Welcome and every flow times out
 * waiting for a library. The addresses themselves are `env.ts`'s.
 */
function storageStateFor(deviceId: string) {
  return {
    cookies: [],
    origins: [
      {
        origin: webUrl,
        localStorage: [
          { name: 'selfmp3.baseUrl', value: appApi },
          { name: 'selfmp3.device.id', value: deviceId },
        ],
      },
    ],
  }
}

export default defineConfig({
  testDir: '.',
  // The app talks to a real server; these are not parallel-safe against one
  // library, since they love songs and edit playlists.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  globalTeardown: './flows/teardown.ts',
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
    // A sleeping Mac is the usual cause of a slow first paint; this is not the
    // thing under test.
    actionTimeout: 10_000,
  },
  /**
   * Two widths, because the app has two layouts and the plan checks both.
   *
   * 1280 is the desktop layout — sidebar, player bar. 375 is the phone layout,
   * the same one the simulator draws.
   */
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        storageState: storageStateFor(FLOW_DEVICE_IDS.desktop),
        viewport: { width: 1280, height: 900 },
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        storageState: storageStateFor(FLOW_DEVICE_IDS.phone),
        viewport: { width: 375, height: 812 },
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
})
