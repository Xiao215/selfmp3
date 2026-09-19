import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Importing: look a link up, review it — leave its song out and bring it back,
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
  const api = process.env.SELFMP3_APP_API ?? new URL(page.url()).origin
  const tools = await page.request
    .get(`${api}/api/import/tools`)
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

/** A phone's swipe left, drawn with the mouse: react-native-web's responder takes both. */
async function swipeLeft(page: Page, row: Locator): Promise<void> {
  const box = await row.boundingBox()
  if (!box) throw new Error('the row is not on screen')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width - 16, y)
  await page.mouse.down()
  await page.mouse.move(box.x + 16, y, { steps: 12 })
  await page.mouse.up()
}

/** Leave the song out, or bring it back, the way this layout does it. */
async function toggleLeftOut(page: Page, back: boolean): Promise<void> {
  if (onPhone(page)) {
    await swipeLeft(page, page.getByRole('button', { name: new RegExp(`^${TITLE}, `) }))
    return
  }
  // On a computer "Leave out" waits under the pointer or keyboard focus, at the
  // row's end; focus is the steadier of the two to drive.
  const toggle = page.getByRole('button', { name: `${back ? 'Bring back' : 'Leave out'} ${TITLE}` })
  await toggle.focus()
  await page.keyboard.press('Enter')
  // Focus off the row again, so its end says what the row is rather than what
  // it offers.
  await page.mouse.click(1, 1)
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

    // The review is a page of its own, and everything on it is coming in.
    await page.waitForURL(/\/import\/review$/, { timeout: 60_000 })
    const count = page.getByText(/^1 of 1 (coming )?in$/)
    await expect(count).toBeVisible()
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    const importOne = page.getByRole('button', { name: 'Import 1 song' })
    await expect(importOne).toBeEnabled()
    await dismissToasts(page)

    // Left out, it stays in the list, says so, and is not counted.
    await toggleLeftOut(page, false)
    await expect(page.getByText('Left out', { exact: true })).toBeVisible()
    await expect(page.getByText(/^0 of 1 (coming )?in$/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import 0 songs' })).toBeDisabled()
    // And the same again brings it back.
    await toggleLeftOut(page, true)
    await expect(page.getByText('Left out', { exact: true })).toHaveCount(0)
    await expect(count).toBeVisible()

    // Opening the song plays it and turns its name into fields; there is no album.
    await page
      .getByRole('button', {
        name: onPhone(page) ? new RegExp(`^${TITLE}, `) : `Edit ${TITLE}`,
      })
      .click()
    // The bar under it, not the player bar's own Seek, which a computer may show too.
    const bar = page.getByTestId('listen-bar')
    await expect(bar).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Album of track 1' })).toHaveCount(0)
    const title = page.getByRole('textbox', { name: 'Title of track 1' })
    await title.fill(`${TITLE} (corrected)`)
    await expect(title).toHaveValue(`${TITLE} (corrected)`)
    await page.getByRole('textbox', { name: 'Artist of track 1' }).fill('jawed karim')
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
