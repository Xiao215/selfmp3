import { expect, test } from '@playwright/test'

import { libraryReady, skipIfNoLibrary, songRows, titleOf } from './helpers.js'

/**
 * The command palette: find a song by its title and play it, then run a command.
 *
 * Desktop only: the palette opens from the sidebar's Search row. A browser tab
 * has no ⌘K (the installed app's menu has it), so the flow clicks the row.
 */

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test.describe('command palette', () => {
  test('finds a song and plays it, and runs a command', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'the palette opens from the sidebar')
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const title = await titleOf(songRows(page).nth(2))
    const box = page.getByRole('combobox', { name: /Search songs, playlists and tags/ })
    const search = page.getByTestId('nav-search')

    // No key of its own in a tab: ⌘K is the browser's.
    await page.keyboard.press('ControlOrMeta+k')
    await expect(box).toBeHidden()

    await search.click()
    await expect(box).toBeVisible()
    await box.fill(title)
    await expect(
      page.getByRole('option', { name: new RegExp(escaped(title)) }).first(),
    ).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(box).toBeHidden()
    await expect(page.getByRole('button', { name: 'Pause' }).last()).toBeVisible()

    // With nothing typed, what is playing leads the list.
    await search.click()
    await expect(
      page.getByRole('option', { name: new RegExp(`^${escaped(title)}, `) }).first(),
    ).toBeVisible()
    await box.fill('Settings')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/settings/)
  })
})
