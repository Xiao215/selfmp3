import { defineConfig } from '@playwright/test'

/**
 * The client download, end to end, against the real YouTube.
 *
 * Not part of `npm run check`: it needs the network, asks YouTube for a song
 * and its answer changes from month to month. Run it by hand to learn whether
 * the page can still download — `npm run build:extension`, then
 * `npx playwright test -c packages/ytclient/verify`. `YT_VIDEOS` picks the
 * songs (ids, comma-separated); `HEADED=1` shows the browser.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 5 * 60_000,
  webServer: {
    command: 'node packages/ytclient/scripts/harness.mjs',
    cwd: '../../..',
    url: 'http://localhost:4602/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
