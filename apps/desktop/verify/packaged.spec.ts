import { expect, test } from '@playwright/test'

import { launchPackaged, packagedExecutable } from './launch'

/**
 * The app electron-builder made, rather than `dist/main.cjs`.
 *
 * Everything in `smoke.spec.ts` launches the unpackaged shell with the
 * repository's Electron, which is the right thing to drive a shell with and not
 * the thing anyone installs: a packaged app reads its files out of an asar,
 * runs its own binary, and on a Mac takes the branch where the title bar is
 * inset. The first Mac build opened to an empty window from exactly that branch,
 * and nothing had ever launched the bundle to see it.
 *
 * It needs a build, so without one it skips and says how to get one — which
 * keeps it runnable on Linux, where the build is an AppImage's unpacked folder.
 */
const executable = packagedExecutable()

test.describe('the packaged app', () => {
  test.skip(
    executable === null,
    'no packaged build for this platform in apps/desktop/release: run npm run build:desktop first',
  )

  test('opens and draws the page', async () => {
    /*
     * The first launch of a freshly built app is slow — macOS scans a new
     * unsigned binary before running it, and this test always follows a
     * build, so it always pays that: 13 s on one run, 46 s on another, past
     * the 90 s default on a Mac that was also building. Later launches take a
     * second. A budget for the scan, not a sign the app is slow.
     */
    test.setTimeout(300_000)
    const app = await launchPackaged(String(executable))
    try {
      const page = await app.firstWindow()
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.waitForLoadState('domcontentloaded')

      expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true)
      expect(page.url()).toBe('app://selfmp3/')
      // The first thing on the sign-in screen is the app's own name; an export
      // that failed to boot leaves the body empty over the window's background.
      await expect(page.locator('body')).toContainText(/self\.mp3/i, { timeout: 30_000 })
      expect(errors).toEqual([])
    } finally {
      await app.close()
    }
  })
})
