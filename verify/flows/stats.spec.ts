import { expect, test, type Page } from '@playwright/test'

/**
 * Stats (`P32`, `C15`): change the window, read the cards, switch the ranked
 * module, and find the way to the month as a page.
 *
 * Read only. The numbers depend on what has been played on this Mac, so the
 * flow checks what the page says about its window, not the counts in it, and
 * skips when nothing has been played at all.
 */

/**
 * Picks a window. A computer has every window as a segment; a phone has one
 * control that opens the list.
 */
async function pickWindow(page: Page, phone: boolean, name: string): Promise<void> {
  if (phone) {
    await page.getByTestId('stats-range').click()
    await page.getByRole('option', { name, exact: true }).click()
  } else {
    await page.getByRole('button', { name, exact: true }).click()
  }
}

test.describe('stats', () => {
  test('switch the window, read the cards, and rank by songs, artists and tags', async ({
    page,
  }, info) => {
    test.setTimeout(60_000)
    const phone = info.project.name === 'phone'

    await page.goto('/stats')
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    // The Overview and Report tabs are gone: the Report is its own page.
    await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('stats-report')).toBeVisible()

    await pickWindow(page, phone, 'All time')
    await expect(page.getByText('All time', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Working it out…')).toHaveCount(0, { timeout: 30_000 })
    test.skip(
      await page.getByText('Nothing to show yet').isVisible(),
      'nothing has been played on this Mac',
    )

    await expect(page.getByTestId('stats-listened')).toBeVisible()
    await expect(page.getByTestId('stats-peak')).toBeVisible()
    await expect(page.getByTestId('stats-streak')).toBeVisible()
    await expect(page.getByTestId('stats-ranked-songs-0')).toBeVisible()

    if (phone) {
      // One list at a time on a phone, switched in place.
      const ranked = page.getByTestId('stats-ranked')
      await ranked.getByRole('button', { name: 'Artists', exact: true }).click()
      await expect(page.getByTestId('stats-ranked-artists-0')).toBeVisible()
      await expect(page.getByTestId('stats-ranked-songs-0')).toHaveCount(0)
      await ranked.getByRole('button', { name: 'Tags', exact: true }).click()
      await expect(
        page.getByTestId('stats-ranked-tags-0').or(page.getByText(/No tagged songs played/)),
      ).toBeVisible()
    } else {
      // A computer has the width for all three side by side.
      await expect(page.getByTestId('stats-ranked-artists-0')).toBeVisible()
      await expect(
        page.getByTestId('stats-ranked').getByRole('heading', { name: 'Tags', exact: true }),
      ).toBeVisible()
    }

    // The window is said under the title.
    await pickWindow(page, phone, 'Week')
    await expect(page.getByText('Last 7 days').first()).toBeVisible()

    // The first song opens its own page — when this device has it: a song the
    // library no longer holds is listed but is not a link.
    await pickWindow(page, phone, 'All time')
    const first = page.getByTestId('stats-ranked-songs-0')
    await expect(first).toBeVisible({ timeout: 30_000 })
    const link = first.and(page.getByRole('link'))
    if ((await link.count()) > 0) {
      await link.click()
      await expect(page).toHaveURL(/\/song\/\d+/)
    }
  })

  test('the month as a page is one step away', async ({ page }) => {
    await page.goto('/stats')
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId('stats-report').click()
    await expect(page).toHaveURL(/\/stats\/report/)
  })
})
