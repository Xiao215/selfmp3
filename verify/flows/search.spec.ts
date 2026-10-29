import { expect, test } from '@playwright/test'

import {
  escaped,
  libraryData,
  libraryReady,
  openLibrary,
  skipIfNoLibrary,
  songRows,
  titleOf,
} from './helpers.js'

/**
 * Search on a phone (docs/ui-mock `P18`–`P20`): one page, the same whichever
 * door opened it. Typed, it shows every section at once; "See all" opens one
 * alone, and the way back returns to all of them.
 */
test.describe('search', () => {
  // eslint-disable-next-line no-empty-pattern -- Playwright hands the test info second.
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'phone', 'a computer opens the palette instead')
  })

  test('Home’s field opens it, with your tags and what you played', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 })
    // The tab bar has no search circle: Home and Library carry the way in.
    await expect(page.getByTestId('tab-search')).toHaveCount(0)
    await page.getByTestId('home-search').click()
    await expect(page).toHaveURL(/\/search$/)
    await expect(page.getByTestId('search-field')).toBeFocused()
    // Searching owns the display: the tab bar and the mini player step aside
    // for it, and Cancel is the way back.
    await expect(page.getByTestId('tab-library')).toHaveCount(0)
    await expect(page.getByTestId('mini-player')).toHaveCount(0)
  })

  test('Library opens the same search, and a song plays from it', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)
    const title = await titleOf(songRows(page).first())

    await page.getByTestId('library-search').click()
    await expect(page).toHaveURL(/\/search$/)

    await page.getByTestId('search-field').fill(title)
    const row = page.getByRole('button', { name: new RegExp(`^${escaped(title)}, `) }).first()
    await expect(row).toBeVisible()
    await row.click()
    // Nothing floats over the search page, so the mini player is there again
    // once the field is closed — with the song it was told to play.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('mini-player')).toContainText(title)
    await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Pause' }).first().click()
  })

  test('“See all” opens one section alone, and the way back returns to all', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)
    // The artist with the most songs: more of them than All shows.
    const { songs } = await libraryData(page)
    const byArtist = new Map<string, number>()
    for (const song of songs) byArtist.set(song.artist, (byArtist.get(song.artist) ?? 0) + 1)
    const [artist, count] = [...byArtist].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
    test.skip(count <= 5, 'no artist has more songs than All shows')

    await page.getByTestId('library-search').click()
    await page.getByTestId('search-field').fill(artist)
    const seeAll = page.getByTestId('search-see-all-songs')
    await seeAll.click()
    await expect(page.getByTestId('search-back')).toContainText(/Songs\s*\d+/)
    await expect(page.getByRole('heading', { name: 'Songs', exact: true })).toHaveCount(0)
    await page.getByTestId('search-back').click()
    await expect(page.getByTestId('search-back')).toHaveCount(0)
    await expect(page.getByTestId('search-see-all-songs')).toBeVisible()
  })

  test('says so when nothing matches, and Cancel goes back', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('home-search').click()
    // Words that match nothing are a question: Ask comes first, and nothing
    // under it says there was nothing (D1).
    await page.getByTestId('search-field').fill('zzqqxxnothing')
    await expect(page.getByTestId('search-ask')).toBeVisible()
    await expect(page.getByText(/Nothing matches/)).toHaveCount(0)
    // Two letters are too few to ask about.
    await page.getByTestId('search-field').fill('zq')
    await expect(page.getByText(/Nothing matches/)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('home-screen')).toBeVisible()
  })
})
