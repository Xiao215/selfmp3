import { expect, test } from '@playwright/test'

/**
 * The month as a page: open `/stats/report`, find the default look, and change it.
 *
 * Read only. A computer opens on the newspaper front page and a phone on Paper
 * (looks.model.ts). The words on the page depend on what has been played on
 * this Mac, so the flow checks which look is drawn, not what it says, and skips
 * when nothing has been played at all.
 */
test.describe('report', () => {
  test('opens on its default look and switches to another', async ({ page }, info) => {
    test.setTimeout(60_000)
    const phone = info.project.name === 'phone'
    const first = phone ? 'paper' : 'front'

    await page.goto('/stats/report')
    await expect(page.getByTestId('report-screen')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Working it out…')).toHaveCount(0, { timeout: 30_000 })

    test.skip(
      await page.getByTestId('report-server-away').isVisible(),
      'the cloud library’s server is not in reach',
    )
    test.skip(
      await page.getByText('The report needs your library').isVisible(),
      'the server did not answer',
    )

    // An empty month is almost always the wrong window: all time is offered.
    const tryAll = page.getByRole('button', { name: 'Try all time', exact: true })
    if (await tryAll.isVisible()) {
      await tryAll.click()
      await expect(page.getByText('Working it out…')).toHaveCount(0, { timeout: 30_000 })
    }
    test.skip(
      await page.getByText('Nothing in your history yet').isVisible(),
      'nothing has been played on this Mac',
    )

    // The default look, chosen in the picker and drawn.
    await expect(page.getByTestId(`report-page-${first}`)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId(`report-look-${first}`)).toHaveAttribute('aria-pressed', 'true')
    // Only a computer has room for the front page.
    await expect(page.getByRole('button', { name: 'Front page', exact: true })).toHaveCount(
      phone ? 0 : 1,
    )

    await page.getByRole('button', { name: 'Words', exact: true }).click()
    await expect(page.getByTestId('report-page-words')).toBeVisible()
    await expect(page.getByTestId(`report-page-${first}`)).toHaveCount(0)
    await expect(page.getByTestId('report-look-words')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId(`report-look-${first}`)).toHaveAttribute('aria-pressed', 'false')

    await page.getByRole('button', { name: 'Receipt', exact: true }).click()
    await expect(page.getByTestId('report-page-receipt')).toBeVisible()
    await expect(page.getByText('THANK YOU FOR LISTENING')).toBeVisible()

    // Save as image saves the page drawn: a PNG named after the window, at
    // least twice the look's own width, whatever size it is shown at.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByTestId('report-share').click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^selfmp3-wrapped-\w+-\d{4}-\d{2}-\d{2}\.png$/)
    const bytes = await (await download.createReadStream()).toArray()
    const png = Buffer.concat(bytes as Buffer[])
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    // The PNG header's width, big-endian at byte 16.
    expect(png.readUInt32BE(16)).toBeGreaterThan(500)
  })
})
