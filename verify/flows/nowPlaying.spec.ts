import { expect, test } from '@playwright/test'

import { libraryReady, playSong, skipIfNoLibrary, songRows } from './helpers.js'

/**
 * Now Playing on a computer, driven from the player bar.
 *
 * The bar opens the page on its lyrics. Up next and About are tabs, and the
 * bar's queue button is the same Up next tab, pressed again to go back. The mic
 * goes straight to Focus, and pressing it again puts the page away. Playback
 * carries on through all of it.
 *
 * Desktop only: a phone's Now Playing is its own full screen, with no tabs.
 */
test.describe('now playing', () => {
  test('the bar opens the page, switches its tabs and focus, and closes it', async ({
    page,
  }, info) => {
    test.skip(info.project.name === 'phone', 'the tabbed page is the computer layout')
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)
    await playSong(page, songRows(page).first())

    await page.getByRole('button', { name: /^Open now playing: / }).click()
    await expect(page.getByRole('tab', { name: /Lyrics|Visual/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    const closeQueue = page.getByRole('button', { name: 'Close queue' })
    await page.getByRole('tab', { name: 'Up next' }).click()
    await expect(closeQueue).toBeVisible()

    const barQueue = page.getByRole('button', { name: 'Queue', exact: true })
    await barQueue.click()
    await expect(closeQueue).toBeHidden()
    await barQueue.click()
    await expect(closeQueue).toBeVisible()

    await page.getByRole('tab', { name: 'About' }).click()
    await expect(page.getByText(/^sound$/i).first()).toBeVisible()

    const mic = page.getByRole('button', { name: 'Lyrics', exact: true })
    await mic.click()
    await expect(page.getByRole('button', { name: 'Back to the full page' }).first()).toBeVisible()
    await mic.click()
    await expect(page.getByRole('button', { name: /^Open now playing: / })).toBeVisible()

    await page.getByRole('button', { name: /^Open now playing: / }).click()
    await page.getByRole('button', { name: 'Close now playing' }).first().click()
    await expect(page.getByRole('button', { name: /^Open now playing: / })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pause' }).last()).toBeVisible()
  })
})
