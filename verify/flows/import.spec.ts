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
    // Words with no link in them are answered at the box, before any fetch.
    const box = page.getByPlaceholder(/music\.youtube\.com\/watch/)
    await box.fill('yoasobi idol')
    await expect(page.getByText(/doesn.t look like a link/)).toBeVisible()
    await expect(fetch).toBeDisabled()
    await box.fill(LINK)
    await expect(page.getByText(/doesn.t look like a link/)).toHaveCount(0)
    await fetch.click()

    await expect(page.getByText('1 track found')).toBeVisible({ timeout: 60_000 })
    // A track the library already has — the same artist and title — starts
    // unticked. Whether this one is depends on the library it runs against,
    // so read what the review says rather than assume it.
    const tick = page.getByRole('checkbox', { name: /^Import / })
    if (await page.getByText('1 already in your library').isVisible()) {
      await expect(page.getByText('0 of 1 selected')).toBeVisible()
      await tick.click()
    }
    await expect(page.getByText('1 of 1 selected')).toBeVisible()

    // Listening before importing: the row's thumbnail plays it, and a bar
    // says what is playing until it is stopped. Nothing reaches the queue.
    await page.getByRole('button', { name: /^Listen to / }).click()
    const bar = page.getByLabel('Listening before import')
    await expect(bar).toBeVisible()
    await bar.getByRole('button', { name: 'Stop listening' }).click()
    await expect(bar).toHaveCount(0)

    // Unticking the only track leaves nothing to import.
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
