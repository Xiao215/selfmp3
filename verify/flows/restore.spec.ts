import { expect, test } from '@playwright/test'

import { libraryReady, playSong, skipIfNoLibrary, songRows } from './helpers.js'

/**
 * Coming back after a refresh.
 *
 * The page remembers what this device was playing, and Now Playing names the
 * song in its address, so reloading comes back to the same song, paused,
 * instead of "Nothing playing" — and the address on its own is enough to open
 * on that song.
 */
test.describe('coming back', () => {
  test('a refresh keeps the song, and the address names it', async ({ page }) => {
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)
    await playSong(page, songRows(page).first())

    const open = page.getByRole('button', { name: /^Open now playing: / })
    await expect(open).toBeVisible()
    const title = ((await open.getAttribute('aria-label')) ?? '').replace(/^Open now playing: /, '')
    expect(title).not.toBe('')

    await open.click()
    await expect(page).toHaveURL(/now-playing\?(.*&)?song=\d+/)
    const address = page.url()

    await page.reload()
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Nothing playing')).toHaveCount(0)

    // The address alone, with nothing remembered.
    await page.evaluate(() => window.localStorage.removeItem('selfmp3.player.session'))
    await page.goto(address)
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(address)
  })
})
