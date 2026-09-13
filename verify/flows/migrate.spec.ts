import { expect, test, type Page } from '@playwright/test'

/**
 * Migrating a playlist: paste songs, match them, choose, and start over.
 *
 * Nothing is imported. Both songs are ones the reference library already has,
 * so the review is the same every run and nothing is ticked for you. Matching
 * searches YouTube through yt-dlp on the Mac; without it the flow skips.
 */

const SONGS = 'YOASOBI - 群青\nアイドル by YOASOBI'

async function skipWithoutYtDlp(page: Page): Promise<void> {
  const api = process.env.SELFMP3_APP_API ?? new URL(page.url()).origin
  const tools = await page.request
    .get(`${api}/api/import/tools`)
    .then(async response =>
      response.ok() ? ((await response.json()) as { ytdlp?: boolean }) : null,
    )
    .catch(() => null)
  test.skip(!tools?.ytdlp, 'the Mac has no yt-dlp to search with')
}

/** The resume toast floats over the bottom of a phone-sized screen. */
async function dismissToasts(page: Page): Promise<void> {
  for (const button of await page.getByRole('button', { name: 'Dismiss' }).all()) {
    await button.click().catch(() => {})
  }
}

test.describe('migrating a playlist', () => {
  test('match two songs, choose them, and start over', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/import/migrate')
    await expect(page.getByRole('heading', { name: 'Migrate a playlist' })).toBeVisible({
      timeout: 30_000,
    })
    await skipWithoutYtDlp(page)
    await dismissToasts(page)

    const find = page.getByRole('button', { name: 'Find matches' })
    await expect(find).toBeDisabled()
    await page.getByPlaceholder(/Get Lucky/).fill(SONGS)
    await find.click()

    await expect(page.getByText('2 of 2 songs matched')).toBeVisible({ timeout: 90_000 })
    // Both are already in the library, so neither is ticked for you.
    await expect(page.getByText('0 selected', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import 0 songs' })).toBeDisabled()

    await dismissToasts(page)
    await page.getByRole('button', { name: 'select all' }).click()
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import 2 songs' })).toBeEnabled()

    await dismissToasts(page)
    await page.getByRole('button', { name: 'Start over' }).click()
    await expect(page.getByRole('button', { name: 'Find matches' })).toBeVisible()
  })
})
