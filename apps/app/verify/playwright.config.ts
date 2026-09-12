import { defineConfig, devices } from '@playwright/test'

/**
 * The two widths everything is checked at.
 *
 * 1280 is the desktop layout and 375 is the phone layout, the same pair
 * docs/UNIVERSAL.md names for the reference captures — the phone app was built
 * to the web app's phone CSS, so a browser at 375 is the phone's reference too.
 * They are projects rather than two configs so a spec can opt into one
 * (`--project=desktop`) or run in both by saying nothing.
 *
 * `PLAYWRIGHT_CHROMIUM_PATH` exists for containers that ship a Chromium build
 * Playwright did not install itself. Unset — which is the case on a Mac after
 * `npx playwright install` — Playwright finds its own.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH

export default defineConfig({
  testDir: '.',
  // A retry would hide a flake, and a flake in a boot check is the finding.
  retries: 0,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      // Playback checks call play() without a click. Without these the browser
      // blocks it and the test measures Chrome's autoplay policy rather than
      // the engine.
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
  ],
})
