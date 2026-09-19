import { expect, test } from '@playwright/test'

import { libraryReady, openLibrary, skipIfNoLibrary, songRows, titleOf, topRow } from './helpers.js'

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

  // Library has no search of its own any more: its field opens the one Search
  // (docs/UI-MIGRATION.md, Phase 3), which search.spec.ts and palette.spec.ts cover.

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
