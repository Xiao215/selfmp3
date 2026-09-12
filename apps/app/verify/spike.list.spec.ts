import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { serve, type StaticServer } from './server'

/**
 * Spike check 6, web half: FlashList v2 scrolls 2,000 rows without blank cells.
 *
 * "No blank cells" is the whole question, so the test scrolls in real steps and
 * asserts that rows are present after each one — a list that recycles badly
 * shows its emptiness during the scroll, not at the end, which is why this does
 * not simply jump to the bottom and look once.
 *
 * The iOS half is .maestro/spike-list.yaml.
 */

let server: StaticServer

test.beforeAll(async () => {
  server = await serve({ dist: join(__dirname, '..', 'dist') })
})

test.afterAll(async () => {
  await server?.close()
})

test('2,000 rows scroll with no blank cells', async ({ page }) => {
  await page.goto(`${server.url}/spike-list`)
  await expect(page.getByTestId('spike-list-page')).toBeVisible()

  // The first row is rendered, and crucially the last one is not: a list that
  // mounted all 2,000 is not virtualising, which at this size is the bug.
  await expect(page.getByTestId('row-0')).toBeVisible()
  expect(await page.getByTestId('row-1999').count()).toBe(0)

  const scroller = page.locator('[data-testid="spike-list"]').first()
  await expect(scroller).toBeVisible()

  const height = await scroller.evaluate((el: HTMLElement) => el.clientHeight)

  // Walk the list a screen at a time. At 56px a row that is roughly a dozen
  // rows per step, which is where recycling either works or visibly does not.
  let emptyAt: number | null = null
  for (let step = 1; step <= 30; step++) {
    await scroller.evaluate((el: HTMLElement, top) => {
      el.scrollTop = top
    }, step * height)

    // Let the list render the new window before looking.
    await page.waitForTimeout(60)

    const rendered = await scroller.evaluate(
      (el: HTMLElement) => el.querySelectorAll('[data-testid^="row-"]').length,
    )
    if (rendered === 0) {
      emptyAt = step
      break
    }
  }

  expect(emptyAt, `the list went blank at scroll step ${emptyAt}`).toBeNull()

  // And the far end really is reachable, with content on it.
  await scroller.evaluate((el: HTMLElement) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(page.getByTestId('row-1999')).toBeVisible()
})
