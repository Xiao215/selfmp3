import { expect, test } from '@playwright/test'

import { libraryReady, playSong, skipIfNoLibrary, songRows, transport } from './helpers.js'

/**
 * Practice: loop a phrase, change the speed, and put it all back.
 *
 * Desktop, where the panel sits beside the page and opens from the player bar.
 * The loop is set by tapping A and B while the song plays, so the flow waits a
 * moment between them for the region to be longer than the shortest a loop may
 * be; it clears the loop, the speed and the playing song before it ends.
 */
test.describe('practice', () => {
  test('set an A–B loop, clear it, and change the speed', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'a phone opens practice from Now Playing')
    test.setTimeout(60_000)
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    await playSong(page, songRows(page).nth(0))
    await expect(transport(page, 'Pause')).toBeVisible()

    await page.getByRole('button', { name: 'Practice tools' }).click()
    await expect(page.getByText('A–B loop').first()).toBeVisible()

    await page.getByRole('button', { name: /^A\s*tap to set/ }).click()
    await page.waitForTimeout(1_600)
    await page.getByRole('button', { name: /^B\s*tap to set/ }).click()
    await expect(page.getByText(/^Looping \d+\.\ds/)).toBeVisible()

    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(page.getByText(/Tap A where the phrase starts/)).toBeVisible()

    await page.getByRole('button', { name: '0.75×', exact: true }).click()
    await expect(page.getByText('0.75×', { exact: true }).first()).toBeVisible()

    // Speed has no bar button of its own: the metronome wears the speed, and
    // opens Practice at Speed.
    await page.getByRole('button', { name: 'Close practice' }).click()
    await expect(page.getByText('A–B loop')).toHaveCount(0)
    await page.getByRole('button', { name: 'Practice tools, speed 0.75×' }).click()
    await page.getByRole('button', { name: '1×', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Practice tools', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Close practice' }).click()
    await expect(page.getByText('A–B loop')).toHaveCount(0)
    await transport(page, 'Pause').click()
  })
})
