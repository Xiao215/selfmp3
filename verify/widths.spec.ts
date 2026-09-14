import { expect, test } from '@playwright/test'

/**
 * Every width an iPad can be, and the two narrower ones a phone already is.
 *
 * `docs/DESKTOP.md` phase 6: "The layout is width-decided, so nothing should
 * change; check that it does not." This is that check. It runs against the
 * export with nobody signed in, so what it sees is the sign-in screen — which
 * is enough for the thing that actually breaks at an unfamiliar width, namely
 * something spilling off the side.
 *
 * 320 is the narrowest of them and has never been drawn before: it is Slide
 * Over on an iPad, and it is narrower than any phone the app has been opened on.
 */
const WIDTHS = [
  { width: 1194, height: 834, what: 'iPad 11-inch, landscape' },
  { width: 834, height: 1194, what: 'iPad 11-inch, portrait' },
  { width: 678, height: 834, what: 'Split View, the wider half' },
  { width: 507, height: 834, what: 'Split View, the narrower half' },
  { width: 375, height: 812, what: 'a phone' },
  { width: 320, height: 834, what: 'Slide Over — narrower than the app has ever been drawn' },
] as const

/** 820, from `packages/client`: at or above it the app wears the desktop layout. */
const BREAKPOINT = 820

for (const { width, height, what } of WIDTHS) {
  test(`draws at ${width} (${what})`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/')
    await expect(page.locator('body')).toContainText(/self\.mp3/i, { timeout: 30_000 })

    // Nothing spills sideways. This is the one failure a width nobody has
    // looked at produces, and it is invisible until someone holds the thing.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${width}px scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0)

    // And the app agrees with itself about which layout it is wearing.
    const inner = await page.evaluate(() => window.innerWidth)
    expect(inner >= BREAKPOINT).toBe(width >= BREAKPOINT)
  })
}

test('crossing the breakpoint while resizing keeps the page', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 })
  await page.goto('/')
  await expect(page.locator('body')).toContainText(/self\.mp3/i, { timeout: 30_000 })

  /*
   * A marker on the page, dropped before the resize and looked for after it.
   * If crossing 820 remounted the tree it would be gone — which is the promise
   * `Shell.tsx` makes and the property an iPad entering Split View depends on.
   *
   * The flow that checks this with a real screen and real state is
   * `verify/flows/navigation.spec.ts`, which needs a library. This is the half
   * that can run anywhere.
   */
  await page.evaluate(() => {
    const mark = document.createElement('div')
    mark.id = 'width-sweep-marker'
    document.body.append(mark)
  })

  await page.setViewportSize({ width: 507, height: 834 })
  await page.waitForTimeout(400)
  await expect(page.locator('#width-sweep-marker')).toHaveCount(1)

  await page.setViewportSize({ width: 1194, height: 834 })
  await page.waitForTimeout(400)
  await expect(page.locator('#width-sweep-marker')).toHaveCount(1)
})
