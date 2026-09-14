import { expect, test } from '@playwright/test'

/**
 * Stats and Wrapped: change the range, open Wrapped, change its range.
 *
 * Read only. The numbers depend on what has been played on this Mac, so the
 * flow checks what the page says about its window, not the counts in it, and
 * skips the Wrapped half when nothing has been played at all.
 */
test.describe('stats', () => {
  test('switch the range, then open Wrapped and switch its range', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/stats')
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: '7d', exact: true }).click()
    await expect(page.getByText('Last 7 days').first()).toBeVisible()
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(page.getByText('All time').first()).toBeVisible()

    test.skip(
      await page.getByText('Nothing to show yet').isVisible(),
      'nothing has been played on this Mac',
    )
    await expect(page.getByText('Most played')).toBeVisible()

    await page.getByText('Wrapped', { exact: true }).first().click()
    await expect(page).toHaveURL(/\/stats\/report/)
    await expect(page.getByRole('heading', { name: 'Wrapped', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'All time', exact: true }).click()
    await expect(page.getByText(/you listened for/i)).toBeVisible()
    await expect(page.getByText('Top songs')).toBeVisible()
  })
})
