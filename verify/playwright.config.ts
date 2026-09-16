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
 * the same one the simulator draws.
 */
/**
 * Where the app is, and where it should look for its Mac.
 *
 * Two addresses, because they are two processes. The server on 4600 serves its
 * own admin page now, not the app, so the app comes from its web dev server on
 * 4601 — `npm run dev` starts both — and has to be told where the API is. It
 * keeps that address through the `secrets` port, which in a browser is
 * `localStorage`; a fresh Playwright context has none, so without the seed
 * below the app quite correctly shows its sign-in screen and every flow times
 * out waiting for a library.
 *
 * Both can be pointed elsewhere:
 *
 *   SELFMP3_WEB_URL=http://localhost:8090 \
 *   SELFMP3_APP_API=http://localhost:4610 npm run verify:flows
 */
const baseURL = process.env.SELFMP3_WEB_URL ?? 'http://localhost:4601'
const appApi = process.env.SELFMP3_APP_API ?? 'http://localhost:4600'

/**
 * One device per width, the same on every run.
 *
 * A fresh browser context has no device id, so every flow otherwise registers
 * with the server under test as a brand-new device — a few days of runs is
 * thousands of rows called "Windows PC · Chrome" (Playwright's desktop Chrome
 * says it runs on Windows). With a fixed id per project a run is two devices,
 * and `flows/teardown.ts` forgets those two when it ends.
 */
export const FLOW_DEVICE_IDS = { desktop: 'playwright-desktop', phone: 'playwright-phone' } as const

function storageStateFor(deviceId: string) {
  return {
    cookies: [],
    origins: [
      {
        origin: baseURL,
        localStorage: [
          ...(appApi ? [{ name: 'selfmp3.baseUrl', value: appApi }] : []),
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
    baseURL,
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
