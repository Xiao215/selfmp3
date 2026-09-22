import { expect, test } from '@playwright/test'

import { appApi } from '../env.js'
import {
  escaped,
  libraryReady,
  openLibrary,
  skipIfNoLibrary,
  songRows,
  titleOf,
} from './helpers.js'

/**
 * The command palette: find a song by its title and play it, then run a command.
 *
 * Desktop only: the palette opens from the sidebar's Search row. A browser tab
 * has no ⌘K (the installed app's menu has it), so the flow clicks the row.
 */

test.describe('command palette', () => {
  test('finds a song and plays it, and runs a command', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'the palette opens from the sidebar')
    await openLibrary(page)
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
    // Clicked rather than Enter: artists and tags come before songs (`C05`),
    // so the first row is not always the song.
    const hit = page.getByRole('option', { name: new RegExp(`^${escaped(title)}, `) }).first()
    await expect(hit).toBeVisible()
    await hit.click()
    await expect(box).toBeHidden()
    await expect(page.getByRole('button', { name: 'Pause' }).last()).toBeVisible()

    // With nothing typed, what is playing leads the list.
    await search.click()
    await expect(
      page.getByRole('option', { name: new RegExp(`^${escaped(title)}, `) }).first(),
    ).toBeVisible()
    await box.fill('Settings')
    // Commands come last once something is typed (`C05`), so the command is clicked.
    await page.getByRole('option', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/\/settings/)
  })

  /**
   * One search, many doors (`P20`): on a computer Home's field, the sidebar's
   * row and Library's field all open the same palette, and it finds artists
   * and tags as well as songs.
   */
  test('every door opens the same search, and it finds an artist', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'a phone opens the Search page instead')
    const box = page.getByRole('combobox', { name: /Search songs, playlists and tags/ })

    await page.goto('/')
    await page.getByTestId('home-search').click()
    await expect(box).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Escape')
    await expect(box).toBeHidden()

    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)
    await page.getByTestId('library-search').click()
    await expect(box).toBeVisible()

    // An artist the library holds, asked of the server, is found as an artist.
    const library = (await (await page.request.get(`${appApi}/api/library`)).json()) as {
      songs: { artist: string; missing: boolean }[]
    }
    const artist = library.songs.find(song => !song.missing && /^[\w ]+$/.test(song.artist))?.artist
    test.skip(!artist, 'no song with a plain artist name to look for')
    await box.fill(artist!)
    await expect(page.getByText('Artists and tags', { exact: false }).first()).toBeVisible()
    await expect(
      page.getByRole('option', { name: new RegExp(`^${escaped(artist!)}, artist$`, 'i') }),
    ).toBeVisible()
  })
})
