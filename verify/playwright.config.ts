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
 * Where the app under test should look for its Mac.
 *
 * Served by the Mac (`npm run build`, then the server on 4600), the app asks
 * its own origin and there is nothing to configure. A dev server on another
 * port has to be told — it keeps the address through the `secrets` port,
 * which in a browser is `localStorage`. A fresh Playwright context has none, so
 * without this the app quite correctly shows its sign-in screen and every flow
 * times out waiting for a library.
 *
 * Set it when pointing these flows at a dev server:
 *
 *   SELFMP3_WEB_URL=http://localhost:8090 \
 *   SELFMP3_APP_API=http://localhost:4600 npm run verify:flows
 */
const baseURL = process.env.SELFMP3_WEB_URL ?? 'http://localhost:4600'
const appApi = process.env.SELFMP3_APP_API

/**
 * One device per width, the same on every run.
 *
 * A fresh browser context has no device id, so every flow used to register
 * with the server under test as a brand-new device: a few days of runs left
 * thousands of rows called "Windows PC · Chrome" (Playwright's desktop Chrome
 * says it runs on Windows). With a fixed id per project a run is two devices,
 * and `flows/teardown.ts` forgets those two when it ends.
 */
export const FLOW_DEVICE_IDS = {
  desktop: 'playwright-desktop',
  phone: 'playwright-phone',
  ipad: 'playwright-ipad',
  ipadSplit: 'playwright-ipad-split',
} as const

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
    /*
     * The iPad's two widths, as a browser stands in for them.
     *
     * `simctl` cannot rotate a simulator or put it in Split View, so the
     * landscape width and the narrower Split View width are checked here, where
     * a viewport is just a number — which is the right place anyway, since the
     * layout is decided by width and by nothing else.
     *
     * 1194 is an 11-inch iPad in landscape and is above the 820 breakpoint, so
     * it should draw the desktop layout. 507 is the narrower half of a 50/50
     * Split View and is below it, so it should draw the phone's. Neither is a
     * new layout; the point is that they are not.
     */
    {
      name: 'ipad',
      use: {
        ...devices['Desktop Chrome'],
        storageState: storageStateFor(FLOW_DEVICE_IDS.ipad),
        viewport: { width: 1194, height: 834 },
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
    {
      name: 'ipad-split',
      use: {
        ...devices['Desktop Chrome'],
        storageState: storageStateFor(FLOW_DEVICE_IDS.ipadSplit),
        viewport: { width: 507, height: 834 },
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
})
