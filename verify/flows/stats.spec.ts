import { expect, test } from '@playwright/test'

/**
 * Stats: change the window, switch to the Report tab, and find the window kept.
 *
 * Read only. The numbers depend on what has been played on this Mac, so the
 * flow checks what the page says about its window, not the counts in it, and
 * skips when nothing has been played at all.
 */
test.describe('stats', () => {
  test('switch the window, then the tab, and keep the window', async ({ page }, info) => {
    test.setTimeout(60_000)
    // A phone names the windows in short: "Wk", "3 mo", "All".
    const phone = info.project.name === 'phone'
    const windowButton = (wide: string, short: string) =>
      page.getByRole('button', { name: phone ? short : wide, exact: true })

    await page.goto('/stats')
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible({
      timeout: 30_000,
    })

    await windowButton('All time', 'All').click()
    await expect(page.getByText('Working it out…')).toHaveCount(0, { timeout: 30_000 })
    test.skip(
      await page.getByText('Nothing to show yet').isVisible(),
      'nothing has been played on this Mac',
    )
    await expect(page.getByText('When you listen')).toBeVisible()
    // The top lists are the Report's now, and said only there.
    await expect(page.getByText('Most played')).toHaveCount(0)

    await windowButton('Week', 'Wk').click()
    await expect(
      page.getByText('Last 7 days').first().or(page.getByText('Nothing to show yet')),
    ).toBeVisible()
    await windowButton('3 months', '3 mo').click()

    // The window chosen on Overview is the one the Report opens on.
    await page.getByRole('button', { name: 'Report', exact: true }).click()
    await expect(
      page
        .getByText(/last 3 months · you listened for/i)
        .or(page.getByText('Nothing in this window yet')),
    ).toBeVisible({ timeout: 30_000 })
    await windowButton('All time', 'All').click()
    await expect(page.getByText(/all time · you listened for/i)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Top songs')).toBeVisible()

    // The report's own address opens the same page on its Report tab.
    await page.goto('/stats/report')
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('button', { name: 'Report', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
