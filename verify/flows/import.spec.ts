import { expect, test, type Page } from '@playwright/test'

/**
 * Importing: paste a link, fetch its details, correct one, and back out.
 *
 * Nothing is imported. The flow stops at the review, because a flow that
 * downloaded a song on every run would grow the library it runs against. The
 * link is a song the reference library already has, so the review is the same
 * every time; it needs yt-dlp on the Mac and YouTube to answer, and skips when
 * the Mac says it has no yt-dlp.
 */

const LINK = 'https://www.youtube.com/watch?v=dGZqpVCJP3k'

/**
 * The resume toast ("Continue … from your other device") floats over the
 * bottom of a phone-sized screen, which is where the review's buttons end up.
 */
async function dismissToasts(page: Page): Promise<void> {
  for (const button of await page.getByRole('button', { name: 'Dismiss' }).all()) {
    await button.click().catch(() => {})
  }
}

async function skipWithoutYtDlp(page: Page): Promise<void> {
  const api = process.env.SELFMP3_APP_API ?? new URL(page.url()).origin
  const tools = await page.request
    .get(`${api}/api/import/tools`)
    .then(async response =>
      response.ok() ? ((await response.json()) as { ytdlp?: boolean }) : null,
    )
    .catch(() => null)
  test.skip(!tools?.ytdlp, 'the Mac has no yt-dlp to read links with')
}

test.describe('importing', () => {
  test('fetch a link, review and correct it, then cancel', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/import')
    await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await skipWithoutYtDlp(page)
    await dismissToasts(page)

    const fetch = page.getByRole('button', { name: 'Fetch details' })
    await expect(fetch).toBeDisabled()
    await page.getByPlaceholder(/music\.youtube\.com\/watch/).fill(LINK)
    await fetch.click()

    await expect(page.getByText('1 track found')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('1 of 1 selected')).toBeVisible()

    // Unticking the only track leaves nothing to import.
    const tick = page.getByRole('checkbox', { name: /^Import / })
    await tick.click()
    await expect(page.getByText('0 of 1 selected')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import 0 tracks' })).toBeDisabled()
    await tick.click()

    // A correction is kept, and counted on the button.
    const title = page.getByRole('textbox', { name: 'Title of track 1' })
    await title.fill('群青 (corrected)')
    await expect(title).toHaveValue('群青 (corrected)')
    await expect(page.getByRole('button', { name: 'Import 1 track' })).toBeEnabled()

    // It can come back while the review was being read.
    await dismissToasts(page)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByText('1 track found')).toHaveCount(0)
  })
})
