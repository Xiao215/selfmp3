import { expect, test } from '@playwright/test'

import { dismissToasts, skipWithoutYtDlp } from './helpers.js'

/**
 * Importing a list of song names: paste them in Import's box, look them up,
 * and see them known as yours.
 *
 * Nothing is imported. Both songs are ones the reference library already has,
 * so the review is the same every run: each is yours already, none is
 * looked for on YouTube, and there is nothing to import. Looking up needs
 * yt-dlp on the Mac; without it the flow skips.
 */

const SONGS = 'YOASOBI - 群青\nアイドル by YOASOBI'

test.describe('a list of song names', () => {
  test('pasted in the box, looked up, and known as yours', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/import')
    await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await skipWithoutYtDlp(page)
    await dismissToasts(page)

    await page.getByRole('textbox', { name: 'Links to import' }).fill(SONGS)
    await expect(page.getByTestId('import-pasted')).toHaveText('A list of song names')
    await page.getByRole('button', { name: 'Look it up' }).click()

    await page.waitForURL(/\/import\/review$/, { timeout: 60_000 })
    // "On your server" where the bucket does not have them yet: still yours.
    await expect(page.getByText(/^(In library|On your server)$/)).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Import 0 songs' })).toBeDisabled()

    await dismissToasts(page)
    // A phone backs out with its ‹; a computer cancels.
    const onPhone = (page.viewportSize()?.width ?? 1280) < 820
    await page
      .getByRole('button', { name: onPhone ? 'Back to Import' : 'Cancel', exact: true })
      .click()
    await page.waitForURL(/\/import$/)
  })
})
