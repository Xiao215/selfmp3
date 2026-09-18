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
    const row = rowFor(page, title)

    const love = row.getByRole('button', { name: `Love ${title}` })
    const unlove = row.getByRole('button', { name: `Remove ${title} from loved` })

    // Start from not-loved whichever way the library happens to be.
    if (await unlove.isVisible()) {
      await unlove.click()
      await expect(love).toBeVisible()
    }

    await love.click()
    // Optimistic: the heart fills without waiting for the round trip.
    await expect(unlove).toBeVisible()

    await page.reload()
    await libraryReady(page)
    // And it was real: the server has it, and the fresh library says so.
    await expect(rowFor(page, title).getByRole('button', { name: /from loved$/ })).toBeVisible()

    // Put it back, so the flow can run again on the same library.
    await rowFor(page, title)
      .getByRole('button', { name: /from loved$/ })
      .click()
    await expect(rowFor(page, title).getByRole('button', { name: `Love ${title}` })).toBeVisible()
  })
})
