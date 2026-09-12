import { expect, test } from '@playwright/test'

import { libraryReady, skipIfNoLibrary, songRows, titleOf } from './helpers.js'

/**
 * Multi-select in the library: the way in, the count, what "all" means, and
 * the way out.
 *
 * Nothing here edits the library. The destructive end of the bar is behind a
 * confirmation that this flow opens far enough to see and then cancels, and
 * the song count is checked afterwards, because a flow that could delete the
 * library it runs against should prove on every run that it did not.
 */
test.describe('selecting songs', () => {
  test('select two, see the count, select all, and get out again', async ({ page }) => {
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const rows = songRows(page)
    const total = await rows.count()
    const first = await titleOf(rows.nth(0))
    const second = await titleOf(rows.nth(1))

    await page.getByRole('button', { name: 'Select', exact: true }).click()
    await page.getByRole('checkbox', { name: `Select ${first}` }).click()
    await page.getByRole('checkbox', { name: `Select ${second}` }).click()
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible()

    // Select-all spells out what "all" is.
    await page.getByRole('checkbox', { name: /^Select all \d+ songs? in your library$/ }).click()
    await expect(page.getByText(`${total} selected`, { exact: true })).toBeVisible()
    await expect(page.getByText('everything in your library')).toBeVisible()

    // The destructive action asks first; cancelling leaves everything.
    await page.getByRole('button', { name: /^More$/ }).click()
    await page
      .getByRole('menuitem', { name: new RegExp(`^Remove ${total} songs from library`) })
      .click()
    await expect(page.getByText(`Remove ${total} songs from your library?`)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
    await expect(page.getByText(`Remove ${total} songs from your library?`)).toHaveCount(0)

    await page.getByRole('button', { name: /^Done selecting/ }).click()
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0)
    await expect(songRows(page)).toHaveCount(total)
  })
})
