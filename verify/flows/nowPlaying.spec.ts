import { expect, test } from '@playwright/test'

import { libraryReady, openLibrary, playSong, skipIfNoLibrary, songRows } from './helpers.js'

/**
 * Now Playing, on both layouts.
 *
 * On a computer the bar opens the page on its lyrics. Lyrics (or Visual) and
 * About are the tabs; Up next is not one of them, since it is the rail beside
 * the page. The page's own button shows only the words, and its chevron goes
 * back to the full page. The title opens the song's own page. Playback
 * carries on through all of it.
 *
 * On a phone the page has no tabs: ⓘ opens the song, the foot is Lyrics,
 * Sleep and Up next, and the lyrics are a second view of the same address.
 */
test.describe('now playing', () => {
  test('the bar opens the page, switches its tabs and focus, and closes it', async ({
    page,
  }, info) => {
    test.skip(info.project.name === 'phone', 'the tabbed page is the computer layout')
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)
    await playSong(page, songRows(page).first())

    await page.getByRole('button', { name: /^Open now playing: / }).click()
    await expect(page.getByRole('tab', { name: /Lyrics|Visual/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(page.getByRole('tab', { name: 'Queue' })).toHaveCount(0)

    await page.getByRole('tab', { name: 'About' }).click()
    await expect(page.getByText(/^sound$/i).first()).toBeVisible()

    // Only the words, from the page's own button, and back to the full page.
    await page.getByRole('tab', { name: /Lyrics|Visual/ }).click()
    await page.getByRole('button', { name: 'Show only the words' }).click()
    await expect(page.getByRole('button', { name: 'Back to the full page' }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Back to the full page' }).first().click()
    await expect(page.getByRole('tab', { name: 'About' })).toBeVisible()

    await page.getByRole('button', { name: 'Close now playing' }).first().click()
    await expect(page.getByRole('button', { name: /^Open now playing: / })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pause' }).last()).toBeVisible()
  })

  test('the title opens the song’s own page', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'a phone opens it from ⓘ, below')
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)
    await playSong(page, songRows(page).first())

    await page.getByRole('button', { name: /^Open now playing: / }).click()
    await page.getByTestId('now-playing-info').click()
    await expect(page).toHaveURL(/\/song\/\d+$/)
    await expect(page.getByTestId('song-screen')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pause' }).last()).toBeVisible()
  })

  test('in Focus the player bar steps aside while the mouse is still', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'Focus is the computer layout')
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)
    await playSong(page, songRows(page).first())

    await page.getByRole('button', { name: /^Open now playing: / }).click()
    await page.getByRole('button', { name: 'Show only the words' }).click()
    await expect(page.getByRole('button', { name: 'Back to the full page' }).first()).toBeVisible()

    // The bar fades rather than leaving (opacity 0, hidden from assistive tech),
    // which Playwright's own visibility does not count, so ask what a reader is told.
    const bar = page.getByTestId('player-bar')
    const stepsAside = bar.locator('xpath=ancestor::*[@aria-hidden="true"]')
    await expect(stepsAside).toHaveCount(1, { timeout: 8_000 })
    await page.mouse.move(400, 300)
    await page.mouse.move(420, 320)
    await expect(stepsAside).toHaveCount(0)
    await expect(bar).toBeVisible()
  })

  test('a phone’s page: no tabs, the foot, the words view, and ⓘ to the song', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'phone', 'the phone page')
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)
    await playSong(page, songRows(page).first())

    await page.getByRole('button', { name: /^Open now playing: / }).click()
    await expect(page.getByTestId('now-playing-info')).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(0)

    // The foot: Lyrics (Visual for a song with none), Sleep and Up next.
    const words = page.getByRole('button', { name: /^(Lyrics|Visual)$/ })
    await expect(words).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sleep', exact: true })).toBeVisible()
    await expect(page.getByTestId('now-playing-queue')).toBeVisible()

    // The words are a view of the same address, and the chevron goes back to the cover.
    await words.click()
    await expect(page).toHaveURL(/now-playing\?(.*&)?view=lyrics/)
    await expect(page.getByTestId('now-playing-lyrics-view')).toBeVisible()
    await expect(page.getByLabel('Seek').first()).toBeVisible()
    await page.getByRole('button', { name: 'Back to the cover' }).click()
    await expect(page.getByTestId('now-playing-lyrics-view')).toHaveCount(0)
    await expect(page).not.toHaveURL(/view=lyrics/)

    // Devices are under ⋯, with Practice.
    await page.getByTestId('now-playing-more').click()
    await expect(page.getByRole('menuitem', { name: /Devices/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Practice/ })).toBeVisible()
    await page.keyboard.press('Escape')

    // ⓘ puts the page away and opens the song's own.
    await page.getByTestId('now-playing-info').click()
    await expect(page).toHaveURL(/\/song\/\d+$/)
    await expect(page.getByTestId('song-screen')).toBeVisible()
  })
})
