import { expect, test } from '@playwright/test'

import {
  libraryReady,
  openLibrary,
  rowFor,
  skipIfNoLibrary,
  songRows,
  titleOf,
  topRow,
} from './helpers.js'

/**
 * The library: the screen that proves `useLibrary` still works.
 *
 * After phase 1 that query lives in `packages/client` and reaches its offline
 * copy through a port rather than importing IndexedDB directly, so "the library
 * still loads, searches and sorts" is exactly what the move could have broken.
 */
test.describe('library', () => {
  test.beforeEach(async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
  })

  test('lists songs', async ({ page }) => {
    await skipIfNoLibrary(page)
    await expect(songRows(page).first()).toBeVisible()
  })

  test('search narrows the list, and clearing it restores it', async ({ page }) => {
    await skipIfNoLibrary(page, 2)
    // The list draws its rows in batches, so count once the count has settled:
    // read too early it is 16 of 36, and clearing the search then "restores" more.
    let before = -1
    await expect
      .poll(async () => {
        const now = await songRows(page).count()
        const settled = now === before
        before = now
        return settled
      })
      .toBe(true)

    const title = await titleOf(await topRow(page))
    const term = title.slice(0, 4).trim()
    test.skip(term.length < 2, 'the first song title is too short to search for')

    await page.getByLabel('Search library').fill(term)
    await expect(rowFor(page, title)).toBeVisible()
    await expect.poll(() => songRows(page).count()).toBeLessThanOrEqual(before)

    await page.getByLabel('Clear search').click()
    await expect.poll(() => songRows(page).count()).toBe(before)
  })

  test('reversing the sort changes which song is first', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'a phone library has no sort: that is a computer’s')
    await skipIfNoLibrary(page, 2)
    // By title, not the default "Recently added": a library scanned in one go
    // has every song added in the same second, and ties keep their order
    // whichever way the arrow points (`sortSongs`), so nothing would move.
    await page.getByRole('combobox', { name: 'Sort by' }).click()
    await page.getByRole('option', { name: 'Title', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Sort by' })).toContainText('Title')
    const first = await titleOf(await topRow(page))

    await page.getByLabel(/^Sort (ascending|descending)$/).click()
    await expect.poll(async () => titleOf(await topRow(page))).not.toBe(first)
  })
})
