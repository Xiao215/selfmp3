import { expect, test } from '@playwright/test'

import { buildUrl } from '../env.js'

/**
 * The installable web app: its manifest, its service worker, and opening with
 * no network.
 *
 * Only a production build registers the worker (a dev server's modules would
 * otherwise be cached and every change hidden), so this runs against the build
 * the Mac serves, not the dev server the other flows use. `buildUrl` in
 * `env.ts` says where — the flows' own address unless SELFMP3_BUILD_URL says
 * otherwise; it skips when no worker is there to test.
 */

test.describe('the installable web app', () => {
  test('has a manifest that takes shared links', async ({ page }) => {
    const response = await page.request.get(`${buildUrl}/manifest.webmanifest`)
    test.skip(
      !response.ok() || (response.headers()['content-type'] ?? '').includes('text/html'),
      'this build has no manifest: export it first (npm run export:web --workspace @selfmp3/app)',
    )
    const manifest = (await response.json()) as {
      share_target?: { action?: string; params?: Record<string, string> }
      icons?: unknown[]
    }
    expect(manifest.share_target?.action).toBe('./import')
    expect(manifest.share_target?.params).toEqual({ url: 'url', text: 'text', title: 'title' })
    expect(manifest.icons?.length).toBeGreaterThan(0)

    await page.goto(`${buildUrl}/`)
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      /manifest\.webmanifest$/,
    )
  })

  test('opens with no network once it has been visited', async ({ page, context }) => {
    test.setTimeout(90_000)
    const worker = await page.request.get(`${buildUrl}/sw.js`)
    test.skip(
      !worker.ok() || (worker.headers()['content-type'] ?? '').includes('text/html'),
      'this build has no service worker',
    )

    await page.goto(`${buildUrl}/`)
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      return registration.scope
    })
    expect(new URL(scope).pathname).toBe('/')

    // The worker controls a page it did not load; the next load is its.
    await page.reload()
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
        timeout: 20_000,
      })
      .toBe(true)
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const names = await caches.keys()
            return names.some(name => name.startsWith('selfmp3-shell-'))
          }),
        { timeout: 20_000 },
      )
      .toBe(true)

    await context.setOffline(true)
    try {
      await page.reload()
      // The shell drew: the app's own markup, not the browser's offline page.
      await expect(page.locator('#root')).not.toBeEmpty({ timeout: 30_000 })
      await expect(page).toHaveTitle('self.mp3')
    } finally {
      await context.setOffline(false)
    }
  })
})
