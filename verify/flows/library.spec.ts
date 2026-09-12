import { expect, test } from '@playwright/test'

import { libraryReady, rowFor, skipIfNoLibrary, songRows, titleOf } from './helpers.js'

/**
 * The library: the screen that proves `useLibrary` still works.
 *
 * After phase 1 that query lives in `packages/client` and reaches its offline
 * copy through a port rather than importing IndexedDB directly, so "the library
 * still loads, searches and sorts" is exactly what the move could have broken.
 */
test.describe('library', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await libraryReady(page)
  })

  test('lists songs', async ({ page }) => {
    await skipIfNoLibrary(page)
    await expect(songRows(page).first()).toBeVisible()
  })

  test('search narrows the list, and clearing it restores it', async ({ page }) => {
    await skipIfNoLibrary(page, 2)
    const before = await songRows(page).count()

    const title = await titleOf(songRows(page).first())
    const term = title.slice(0, 4).trim()
    test.skip(term.length < 2, 'the first song title is too short to search for')

    await page.getByLabel('Search library').fill(term)
    await expect(rowFor(page, title)).toBeVisible()
    await expect.poll(() => songRows(page).count()).toBeLessThanOrEqual(before)

    await page.getByLabel('Clear search').click()
    await expect.poll(() => songRows(page).count()).toBe(before)
  })

  test('reversing the sort changes which song is first', async ({ page }) => {
    await skipIfNoLibrary(page, 2)
    const first = await titleOf(songRows(page).first())

    await page.getByLabel(/^Sort (ascending|descending)$/).click()
    await expect.poll(async () => titleOf(songRows(page).first())).not.toBe(first)
  })
})
