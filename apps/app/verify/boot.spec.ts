import { expect, test } from '@playwright/test'

import { serve, type StaticServer } from './server.js'

/**
 * Does the universal app actually come up in a browser?
 *
 * `expo export -p web` succeeding proves the bundle was built, not that it
 * runs — a module that throws at import time exports perfectly and then paints
 * a white screen. That is the failure this catches, and it is the one that
 * would otherwise be found by opening a browser by hand, which nobody does on
 * every commit.
 *
 * There is no server behind the app here, so what "up" means is: the router
 * mounted, React rendered something, and nothing threw on the way. With no Mac
 * configured and no cloud session the app lands on onboarding, which is
 * correct behaviour and a perfectly good thing to assert.
 *
 * Both widths, because the phone app's own layout switches at 820 and a shell
 * that only mounts at one of them is a real bug.
 */
let server: StaticServer

test.beforeAll(async () => {
  server = await serve({ dist: `${__dirname}/../dist` })
})

test.afterAll(async () => {
  await server?.close()
})

test('comes up, and says what it needs', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error).split('\n')[0]))

  await page.goto(server.url, { waitUntil: 'networkidle' })

  // Something rendered. `#root` with no children is the white screen.
  await expect
    .poll(() => page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0)

  // And it is the onboarding screen, since nothing has told it where the Mac
  // is. Matching on the address prompt rather than a heading, because that is
  // the thing onboarding exists to ask for.
  await expect(page.getByText(/server|address|mac|sign in/i).first()).toBeVisible({
    timeout: 20_000,
  })

  expect(errors, `uncaught errors while booting:\n${errors.join('\n')}`).toEqual([])
})
