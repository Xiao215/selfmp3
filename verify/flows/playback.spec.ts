import { expect, test } from '@playwright/test'

import {
  libraryReady,
  playSong,
  positionSeconds,
  seekReady,
  skipIfNoLibrary,
  songRows,
  titleOf,
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
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    await playSong(page, songRows(page).first())

    // The transport turns into a pause button once it is actually playing.
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

    // And the audio is really advancing, rather than the UI having said so.
    await seekReady(page)
    await expect.poll(() => positionSeconds(page), { timeout: 15_000 }).toBeGreaterThan(0.5)

    await transport(page, 'Pause').click()
    await expect(transport(page, 'Play')).toBeVisible()
  })

  test('next moves to another song', async ({ page }) => {
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page, 2)

    const first = await titleOf(songRows(page).first())
    await playSong(page, songRows(page).first())
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

    await page.getByRole('button', { name: 'Next' }).click()
    // The now-playing control is labelled with whatever is now playing.
    await expect(page.getByRole('button', { name: /^Open now playing: / })).not.toHaveAttribute(
      'aria-label',
      `Open now playing: ${first}`,
    )

    await transport(page, 'Pause').click()
  })
})
