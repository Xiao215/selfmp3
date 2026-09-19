import { expect, test } from '@playwright/test'

import {
  escaped,
  libraryReady,
  openLibrary,
  skipIfNoLibrary,
  songRows,
  titleOf,
} from './helpers.js'

/**
 * Search on a phone (docs/ui-mock `P18`–`P20`): one page, whichever door opened
 * it. The door only picks the scope it starts on — All from the search circle
 * and Home, Songs from Library.
 */
test.describe('search', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright hands the test info second.
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'phone', 'a computer opens the palette instead')
  })

  test('the circle opens it on All, with your tags and what you played', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('tab-search').click()
    await expect(page).toHaveURL(/\/search\?scope=all/)
    await expect(page.getByTestId('search-field')).toBeFocused()
    await expect(page.getByTestId('search-scope-all').getByRole('button')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The tab it was opened from stays lit.
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('Library opens it on Songs, and a song plays from it', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)
    const title = await titleOf(songRows(page).first())

    await page.getByTestId('library-search').click()
    await expect(page).toHaveURL(/\/search\?scope=songs/)
    await expect(page.getByTestId('search-scope-songs').getByRole('button')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.getByTestId('search-field').fill(title)
    // Counts appear on the scopes once something is typed.
    await expect(page.getByTestId('search-scope-songs')).toContainText(/Songs · \d+/)
    const row = page.getByRole('button', { name: new RegExp(`^${escaped(title)}, `) }).first()
    await expect(row).toBeVisible()
    await row.click()
    await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Pause' }).first().click()
  })

  test('says so when nothing matches, and Cancel goes back', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('home-search').click()
    await page.getByTestId('search-field').fill('zzqqxxnothing')
    await expect(page.getByText(/Nothing matches/)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('home-screen')).toBeVisible()
  })
})
