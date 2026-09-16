import { expect, test } from '@playwright/test'

import { libraryReady, playSong, skipIfNoLibrary, songRows } from './helpers.js'

/**
 * Now Playing on a computer, driven from the player bar.
 *
 * The bar opens the page on its lyrics. Queue and About are tabs, and the
 * bar's queue button is the same Queue tab, pressed again to go back. The
 * page's own button shows only the words, and its chevron goes back to the full
 * page. Playback carries on through all of it.
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
    await page.getByRole('tab', { name: 'Queue' }).click()
    await expect(closeQueue).toBeVisible()

    // Auto-mix, on its own row: it says what the next handover will be, and
    // goes back to queue order when it is switched off.
    const autoMix = page.getByLabel('Auto-mix', { exact: true })
    await expect(page.getByText('plays in queue order')).toBeVisible()
    await autoMix.click()
    await expect(page.getByText(/^(next crossfade \d+s|nothing to mix yet)$/)).toBeVisible()
    await autoMix.click()
    await expect(page.getByText('plays in queue order')).toBeVisible()

    const barQueue = page.getByRole('button', { name: 'Queue', exact: true })
    await barQueue.click()
    await expect(closeQueue).toBeHidden()
    await barQueue.click()
    await expect(closeQueue).toBeVisible()

    await page.getByRole('tab', { name: 'About' }).click()
    await expect(page.getByText(/^sound$/i).first()).toBeVisible()

    // Only the words, from the page's own button, and back to the full page.
    await page.getByRole('tab', { name: /Lyrics|Visual/ }).click()
    await page.getByRole('button', { name: 'Show only the words' }).click()
    await expect(page.getByRole('button', { name: 'Back to the full page' }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Back to the full page' }).first().click()
    await expect(page.getByRole('tab', { name: 'Queue' })).toBeVisible()

    await page.getByRole('button', { name: 'Close now playing' }).first().click()
    await expect(page.getByRole('button', { name: /^Open now playing: / })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pause' }).last()).toBeVisible()
  })

  test('in Focus the player bar steps aside while the mouse is still', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'Focus is the computer layout')
    await page.goto('/')
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

  test('a phone shows similar songs under the controls, and plays one', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'phone',
      'the shelf is the phone page’s; the stage has no room for it',
    )
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page, 3)
    await playSong(page, songRows(page).first())

    await page.getByRole('button', { name: /^Open now playing: / }).click()
    const heading = page.getByRole('heading', { name: 'Similar songs' })
    const shown = await heading
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!shown, 'the server found nothing similar: the library has no analysed songs')
    await expect(page.getByRole('button', { name: /^Play .+ by / }).first()).toBeVisible()

    await expect(page.getByRole('button', { name: 'Queue all' })).toBeVisible()

    // A card plays its own song first, with the rest of the shelf after it: the
    // queue is as long as the shelf was, and the new shelf has no card for the
    // song now playing, since nothing is similar to itself.
    const cards = page.getByRole('button', { name: /^Play .+ by / })
    const count = await cards.count()
    const label = (await cards.first().getAttribute('aria-label')) ?? ''
    await cards.first().click()
    await expect(page.getByText(`Playing · 1 of ${count}`, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
  })
})
