import { expect, test, type Locator, type Page } from '@playwright/test'

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
 * Multi-select in the library: the way in, the count, what "all" means, and
 * the way out.
 *
 * There is no Select button. On a computer a row's checkbox is the way in; on
 * a phone, holding a row selects it.
 *
 * Nothing here edits the library. The destructive end of the bar is behind a
 * confirmation that this flow opens far enough to see and then cancels, and
 * the song count is checked afterwards, because a flow that could delete the
 * library it runs against should prove on every run that it did not.
 */
/**
 * The count, however the bar draws it: one line of text at desktop width, and
 * on a phone the figure in a pill beside the word — which is one phrase to a
 * screen reader either way, so that is what this asks for.
 */
function selectionCount(page: Page, n: number) {
  return page.getByLabel(`${n} selected`, { exact: true }).first()
}

test.describe('selecting songs', () => {
  test('select two, see the count, select all, and get out again', async ({ page }, info) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page, 2)

    const rows = songRows(page)
    // What is drawn, which is not the library: a long list draws a screenful
    // or so. The library's own count is the one select-all states.
    const drawn = await rows.count()
    const stated = async (control: Locator): Promise<number> => {
      const name = await control.evaluate(
        el => el.getAttribute('aria-label') ?? el.textContent ?? '',
      )
      return Number(/^Select all (\d+) /.exec(name)?.[1])
    }
    const first = await titleOf(rows.nth(0))
    const second = await titleOf(rows.nth(1))

    await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0)

    if (info.project.name === 'phone') {
      // Held, the way a thumb does it: the row's own press, kept down.
      const box = (await page
        .getByRole('button', { name: new RegExp(`^${escaped(first)}, `) })
        .first()
        .boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(700)
      await page.mouse.up()
      await expect(selectionCount(page, 1)).toBeVisible()
    } else {
      await rows.nth(0).hover()
      await page.getByRole('checkbox', { name: `Select ${first}` }).click()
    }
    await page.getByRole('checkbox', { name: `Select ${second}` }).click()
    await expect(selectionCount(page, 2)).toBeVisible()

    // Select-all spells out what "all" is. A phone's bar is one line of icons,
    // and select-all is the first thing in its More.
    let total: number
    if (info.project.name === 'phone') {
      await page.getByRole('button', { name: /^More$/ }).click()
      const selectAll = page.getByRole('menuitem', {
        name: /^Select all \d+ songs? in your library$/,
      })
      total = await stated(selectAll)
      await selectAll.click()
      await expect(selectionCount(page, total)).toBeVisible()
    } else {
      const selectAll = page.getByRole('checkbox', {
        name: /^Select all \d+ songs? in your library$/,
      })
      total = await stated(selectAll)
      await selectAll.click()
      await expect(selectionCount(page, total)).toBeVisible()
      await expect(page.getByText('everything in your library')).toBeVisible()
    }
    expect(total).toBeGreaterThanOrEqual(drawn)

    // The destructive action asks first; cancelling leaves everything.
    await page.getByRole('button', { name: /^More$/ }).click()
    await page
      .getByRole('menuitem', { name: new RegExp(`^Remove ${total} songs from library`) })
      .click()
    await expect(page.getByText(`Remove ${total} songs from your library?`)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
    await expect(page.getByText(`Remove ${total} songs from your library?`)).toHaveCount(0)

    await page.getByRole('button', { name: /^Done selecting/ }).click()
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0)
    // Asked of the server rather than counted off the screen, which draws a
    // different number of rows once select-all has scrolled through them.
    const library = (await (await page.request.get(`${appApi}/api/library`)).json()) as {
      songs: { missing: boolean }[]
    }
    // Library lists, and so selects, only songs whose file is there; a song
    // the server kept after its file vanished is not a row to select.
    expect(library.songs.filter(song => !song.missing)).toHaveLength(total)
  })

  /**
   * A tag's page selects as the library does. Holding a row there opened its
   * ⋯ menu, and nothing on the page could be ticked (Xiao, 2026-10-02). A tag
   * has no order of its own to change, so a hold there means what it means in
   * the library.
   */
  test('a tag’s page selects as the library does', async ({ page }, info) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page, 2)

    const library = (await (await page.request.get(`${appApi}/api/library`)).json()) as {
      songs: { tagIds: number[]; missing: boolean }[]
      tags: { id: number; name: string }[]
    }
    const present = library.songs.filter(song => !song.missing)
    const size = (id: number) => present.filter(song => song.tagIds.includes(id)).length
    const tag = library.tags.find(entry => size(entry.id) >= 2)
    test.skip(!tag, 'needs a tag on two songs')
    if (!tag) return

    await page.goto(`/tag/${encodeURIComponent(tag.name)}`)
    const rows = songRows(page)
    await expect(rows.nth(1)).toBeVisible({ timeout: 30_000 })
    const first = await titleOf(rows.nth(0))
    const second = await titleOf(rows.nth(1))

    if (info.project.name === 'phone') {
      const box = (await page
        .getByRole('button', { name: new RegExp(`^${escaped(first)}, `) })
        .first()
        .boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(700)
      await page.mouse.up()
      await expect(selectionCount(page, 1)).toBeVisible()
      // The hold selected, and did not open the song's menu as well.
      await expect(page.getByTestId('song-menu')).toHaveCount(0)
    } else {
      await rows.nth(0).hover()
      await page.getByRole('checkbox', { name: `Select ${first}` }).click()
    }
    await page.getByRole('checkbox', { name: `Select ${second}` }).click()
    await expect(selectionCount(page, 2)).toBeVisible()

    // "All" is this tag's songs, and the bar says so.
    const everyOne = `Select all ${size(tag.id)} songs in this tag`
    if (info.project.name === 'phone') {
      await page.getByRole('button', { name: /^More$/ }).click()
      await page.getByRole('menuitem', { name: everyOne }).click()
    } else {
      await page.getByRole('checkbox', { name: everyOne }).click()
    }
    await expect(selectionCount(page, size(tag.id))).toBeVisible()

    await page.getByRole('button', { name: /^Done selecting/ }).click()
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0)
  })
})
