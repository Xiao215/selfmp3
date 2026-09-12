import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { serve, type StaticServer } from './server'

/**
 * Spike check 2, web half: Unistyles 3 gives the browser a real `:hover` rule
 * and a working 820-point breakpoint.
 *
 * Foundation 6 says hover reveals exist wherever there is a pointer, and
 * foundation 5 says one component carries both layouts as variants. Both are
 * claims about CSS, so both are read back from the computed style rather than
 * from a snapshot — a screenshot would pass on a component that merely happened
 * to look right.
 *
 * The other half of check 2 — Unistyles and track-player building into one dev
 * client — needs Xcode and is left to .maestro/spike-unistyles.yaml.
 */

let server: StaticServer

test.beforeAll(async () => {
  server = await serve({ dist: join(__dirname, '..', 'dist') })
})

test.afterAll(async () => {
  await server?.close()
})

/** `rgb(58, 52, 72)` — theme.colors.hover in src/spike/unistyles.ts. */
const HOVER = 'rgb(58, 52, 72)'
/** `rgb(34, 31, 43)` — theme.colors.raised, the resting colour. */
const RAISED = 'rgb(34, 31, 43)'

test('the breakpoint switches the layout at 820', async ({ page }, testInfo) => {
  await page.goto(`${server.url}/spike-hover`)
  const card = page.getByTestId('spike-card')
  await expect(card).toBeVisible()

  const { flexDirection, maxWidth } = await card.evaluate((el) => {
    const style = getComputedStyle(el)
    return { flexDirection: style.flexDirection, maxWidth: style.maxWidth }
  })

  // The desktop project is 1280 and the phone project is 375 — one either side
  // of the breakpoint, which is the whole point of running this in both.
  if (testInfo.project.name === 'desktop') {
    expect(flexDirection).toBe('row')
    expect(maxWidth).toBe('640px')
  } else {
    expect(flexDirection).toBe('column')
    expect(maxWidth).toBe('320px')
  }
})

test('hover is a real CSS rule, not a JavaScript listener', async ({ page }) => {
  await page.goto(`${server.url}/spike-hover`)
  const card = page.getByTestId('spike-card')
  await expect(card).toBeVisible()

  const background = () =>
    card.evaluate((el) => getComputedStyle(el).backgroundColor)

  expect(await background()).toBe(RAISED)

  await card.hover()
  await expect.poll(background).toBe(HOVER)

  // And back: a hover that never lets go is a stuck row in the library.
  await page.mouse.move(0, 0)
  await expect.poll(background).toBe(RAISED)
})
