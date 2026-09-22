import { expect, test, type Page } from '@playwright/test'

import { appApi } from '../env.js'

/**
 * Importing: look a link up, review it — untick its song and tick it back,
 * rename it, hear it — and back out (docs/UI-MIGRATION.md, Phase 7).
 *
 * Nothing is imported. The flow stops at the review, because a flow that
 * downloaded a song on every run would grow the library it runs against. The
 * link is the first video YouTube ever had, which no music library holds, so
 * the song is always coming in rather than "Yours already" and every part of
 * the review can be tried; it needs yt-dlp on the Mac and YouTube to answer,
 * and skips when the Mac says it has no yt-dlp.
 */

const LINK = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const TITLE = 'Me at the zoo'

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
  const tools = await page.request
    .get(`${appApi}/api/import/tools`)
    .then(async response =>
      response.ok() ? ((await response.json()) as { ytdlp?: boolean }) : null,
    )
    .catch(() => null)
  test.skip(!tools?.ytdlp, 'the Mac has no yt-dlp to read links with')
}

/** Whether this run is the phone's layout, where rows swipe and open in place. */
function onPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 820
}

test.describe('importing', () => {
  test('look a link up, thin and rename its review, then back out', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/import')
    await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await skipWithoutYtDlp(page)
    await dismissToasts(page)

    const lookUp = page.getByRole('button', { name: 'Look it up' })
    await expect(lookUp).toBeDisabled()
    // Words with no link in them are answered at the field, before any lookup.
    const box = page.getByRole('textbox', { name: 'Links to import' })
    await box.fill('yoasobi idol')
    await expect(page.getByText(/doesn.t look like a link/)).toBeVisible()
    await expect(lookUp).toBeDisabled()
    await box.fill(LINK)
    await expect(page.getByText(/doesn.t look like a link/)).toHaveCount(0)
    await lookUp.click()

    // The review is a page of its own, and everything on it starts ticked.
    await page.waitForURL(/\/import\/review$/, { timeout: 60_000 })
    const count = page.getByText(/^1 of 1 (coming )?in$/)
    await expect(count).toBeVisible()
    const tick = page.getByRole('checkbox', { name: `Deselect ${TITLE}` })
    await expect(tick).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Deselect all' })).toBeChecked()
    const importOne = page.getByRole('button', { name: 'Import 1 song' })
    await expect(importOne).toBeEnabled()
    await dismissToasts(page)

    // Unticked, it stays in the list and is not counted.
    await tick.click()
    const unticked = page.getByRole('checkbox', { name: `Select ${TITLE}` })
    await expect(unticked).not.toBeChecked()
    await expect(page.getByText(TITLE, { exact: true })).toBeVisible()
    await expect(page.getByText(/^0 of 1 (coming )?in$/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import 0 songs' })).toBeDisabled()
    // The head's box ticks everything back.
    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await expect(tick).toBeChecked()
    await expect(count).toBeVisible()

    // Opening the song plays it and turns its name into fields, the album with them.
    await page
      .getByRole('button', {
        name: onPhone(page) ? new RegExp(`^${TITLE}, `) : `Edit ${TITLE}`,
      })
      .click()
    // The bar under it, not the player bar's own Seek, which a computer may show too.
    const bar = page.getByTestId('listen-bar')
    await expect(bar).toBeVisible()
    const title = page.getByRole('textbox', { name: 'Title of track 1' })
    await title.fill(`${TITLE} (corrected)`)
    await expect(title).toHaveValue(`${TITLE} (corrected)`)
    await page.getByRole('textbox', { name: 'Artist of track 1' }).fill('jawed karim')
    await page.getByRole('textbox', { name: 'Album of track 1' }).fill('San Diego Zoo')
    // A rename is not a leave-out: the count and the button stay as they were.
    await expect(count).toBeVisible()
    await expect(importOne).toBeEnabled()

    await dismissToasts(page)
    if (onPhone(page)) {
      // The cover closes the row again, and the row keeps the new name.
      await page.getByRole('button', { name: `Close ${TITLE} (corrected)` }).click()
      await expect(bar).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: `${TITLE} (corrected), jawed karim` }),
      ).toBeVisible()
      // Back keeps the review, and Import offers it again.
      await page.getByRole('button', { name: 'Back to Import' }).click()
      await page.waitForURL(/\/import$/)
      await page.getByRole('link', { name: `Go on reviewing ${TITLE} (corrected)` }).click()
      await page.waitForURL(/\/import\/review$/)
      await expect(count).toBeVisible()
    } else {
      // Cancel lets the review go.
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.waitForURL(/\/import$/)
      await expect(page.getByRole('link', { name: /^Go on reviewing / })).toHaveCount(0)
    }
  })
})
