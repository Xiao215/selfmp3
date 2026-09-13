import { expect, test } from '@playwright/test'

import { libraryReady, skipIfNoLibrary, songRows, titleOf } from './helpers.js'

/**
 * The ⌘K palette: find a song by its title and play it, then run a command.
 *
 * Desktop only: the palette is opened from a keyboard.
 */

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test.describe('command palette', () => {
  test('finds a song and plays it, and runs a command', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'the palette is opened from a keyboard')
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const title = await titleOf(songRows(page).nth(2))
    const box = page.getByRole('combobox', { name: /Search songs, playlists and tags/ })

    await page.keyboard.press('ControlOrMeta+k')
    await expect(box).toBeVisible()
    await box.fill(title)
    await expect(
      page.getByRole('option', { name: new RegExp(escaped(title)) }).first(),
    ).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(box).toBeHidden()
    await expect(page.getByRole('button', { name: 'Pause' }).last()).toBeVisible()

    await page.keyboard.press('ControlOrMeta+k')
    await box.fill('Settings')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/settings/)
  })
})
