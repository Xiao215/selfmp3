import { defineConfig } from '@playwright/test'

/**
 * The desktop smoke.
 *
 * It drives the *built* shell — `apps/desktop/dist/main.cjs` and the export
 * copied beside it — through Playwright's `_electron`, so what is tested is the
 * product rather than a development window. `app.evaluate` reads the main
 * process directly, which is how a question like "did the protocol answer that"
 * gets an answer instead of an inference.
 *
 * One worker: there is one app, it takes a single-instance lock, and a second
 * launch would hand its arguments to the first and exit.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
})
