import { expect, test } from '@playwright/test'

import { libraryReady, openLibrary, rowFor, skipIfNoLibrary, songRows, titleOf } from './helpers.js'

/**
 * Loving a song: the mutation path, end to end.
 *
 * The most valuable flow of the set after phase 1, because `useToggleLoved` is
 * optimistic — it patches the cache, writes the offline copy, and rolls both
 * back if the server refuses. That whole hook moved into `packages/client`, and
 * the optimism is the part where a silent break looks fine until you reload.
 *
 * So this flow reloads. A heart that fills and then empties on refresh means
 * the request never reached the Mac and the rollback never happened either.
 */
test.describe('loving a song', () => {
  test('survives a reload, and can be undone', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const title = await titleOf(songRows(page).first())
    // The heart lives in the song's menu now (docs/ui-mock `P14`), not on the row.
    const openMenu = async (): Promise<void> => {
      await rowFor(page, title)
        .getByRole('button', { name: `More actions for ${title}` })
        .click()
    }
    const like = page.getByRole('button', { name: 'Like', exact: true })
    const unlike = page.getByRole('button', { name: 'Unlike', exact: true })

    await openMenu()
    await expect(like.or(unlike)).toBeVisible()
    // Start from not-loved whichever way the library happens to be.
    if (await unlike.isVisible()) {
      await unlike.click()
      await expect(like).toBeVisible()
    }

    await like.click()
    // Optimistic: the heart fills without waiting for the round trip.
    await expect(unlike).toBeVisible()

    await page.reload()
    await libraryReady(page)
    // And it was real: the server has it, and the fresh library says so.
    await openMenu()
    await expect(unlike).toBeVisible()

    // Put it back, so the flow can run again on the same library.
    await unlike.click()
    await expect(like).toBeVisible()
  })
})
