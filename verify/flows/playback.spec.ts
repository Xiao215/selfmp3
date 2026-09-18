import { expect, test } from '@playwright/test'

import {
  libraryReady,
  openLibrary,
  playSong,
  positionSeconds,
  seekReady,
  skipIfNoLibrary,
  titleOf,
  topRow,
  transport,
} from './helpers.js'

/**
 * Playing something, which is what the app is for.
 *
 * Phase 1 did not touch the engine — that is phase 3 — but it did move the
 * media URLs that tell the engine what to fetch, and a stream URL built wrong
 * fails exactly here and nowhere else. The unit tests cannot catch it: they
 * check the string, and only a browser checks that the string plays.
 */
test.describe('playback', () => {
  test('a song plays, and the player bar shows it', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)

    await playSong(page, await topRow(page))

    // The transport turns into a pause button once it is actually playing.
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

    // And the audio is really advancing, rather than the UI having said so.
    await seekReady(page)
    await expect.poll(() => positionSeconds(page), { timeout: 15_000 }).toBeGreaterThan(0.5)

    await transport(page, 'Pause').click()
    await expect(transport(page, 'Play')).toBeVisible()
  })

  /*
   * A browser tab's one app shortcut. It is pressed right after starting the
   * song from its row, where focus is on that row's button — which took Space
   * as a press of itself and played the song again from the start.
   */
  test('Space pauses and plays again', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)

    await playSong(page, await topRow(page))
    await expect(transport(page, 'Pause')).toBeVisible()

    await page.keyboard.press('Space')
    await expect(transport(page, 'Play')).toBeVisible()
    await page.keyboard.press('Space')
    await expect(transport(page, 'Pause')).toBeVisible()

    // Typing in the search field is typing, not playback.
    const search = page.getByLabel('Search library')
    if (await search.isVisible()) {
      await search.fill('')
      await search.pressSequentially('a b')
      await expect(search).toHaveValue('a b')
      await expect(transport(page, 'Pause')).toBeVisible()
      await search.fill('')
    }

    await transport(page, 'Pause').click()
  })

  test('next moves to another song', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page, 2)

    const first = await titleOf(await topRow(page))
    await playSong(page, await topRow(page))
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

    await page.getByRole('button', { name: 'Next', exact: true }).click()
    // The now-playing control is labelled with whatever is now playing.
    await expect(page.getByRole('button', { name: /^Open now playing: / })).not.toHaveAttribute(
      'aria-label',
      `Open now playing: ${first}`,
    )

    await transport(page, 'Pause').click()
  })
})
