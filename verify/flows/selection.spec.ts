import { expect, test, type Locator, type Page } from '@playwright/test'

import { appApi } from '../env.js'
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
 * Multi-select in the library: the way in, the count, what "all" means, and
 * the way out.
 *
 * There is no Select button. On a computer a row's checkbox is the way in; on
 * a phone, holding a row selects it — except where holding moves the row,
 * and there the list's ⋯ has Select songs.
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
      const before = await rows.nth(1).boundingBox()
      await page.getByRole('checkbox', { name: `Select ${first}` }).click()
      await expect(selectionCount(page, 1)).toBeVisible()
      // The bar arriving moves no row: the next tick lands where it was aimed (X7).
      await page.waitForTimeout(400)
      expect((await rows.nth(1).boundingBox())?.y).toBe(before?.y)
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
      .getByRole('menuitem', { name: new RegExp(`^Delete ${total} songs from library`) })
      .click()
    await expect(page.getByText(`Delete ${total} songs?`)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
    await expect(page.getByText(`Delete ${total} songs?`)).toHaveCount(0)

    await page.getByRole('button', { name: /^Done selecting/ }).click()
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0)
    // Asked of the server rather than counted off the screen, which draws a
    // different number of rows once select-all has scrolled through them.
    const { songs } = await libraryData(page)
    expect(songs).toHaveLength(total)
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

    const { songs, tags } = await libraryData(page)
    const size = (id: number) => songs.filter(song => song.tagIds.includes(id)).length
    const tag = tags.find(entry => size(entry.id) >= 2)
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
      const before = await rows.nth(1).boundingBox()
      await page.getByRole('checkbox', { name: `Select ${first}` }).click()
      await expect(selectionCount(page, 1)).toBeVisible()
      // The bar arriving moves no row: the next tick lands where it was aimed (X7).
      await page.waitForTimeout(400)
      expect((await rows.nth(1).boundingBox())?.y).toBe(before?.y)
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

  /**
   * Holding means two things with one rule (D1): moving in a list whose order
   * is yours, selecting everywhere else. Search's hold used to open the song's
   * menu; now it selects, with Library's bar.
   */
  test('a hold in Search selects, as Library’s does', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'a computer searches in the palette')
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page, 2)
    const title = await titleOf(songRows(page).first())

    await page.getByTestId('library-search').click()
    await page.getByTestId('search-field').fill(title)
    const row = page.getByRole('button', { name: new RegExp(`^${escaped(title)}, `) }).first()
    await expect(row).toBeVisible()
    const box = (await row.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.up()
    await expect(selectionCount(page, 1)).toBeVisible()
    await expect(page.getByTestId('song-menu')).toHaveCount(0)

    await page.getByRole('button', { name: /^Done selecting/ }).click()
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0)
  })

  /**
   * In a playlist you made, holding a row moves it, so selecting starts from
   * the playlist's ⋯ — the phone's only way to remove several songs at once.
   */
  test('a playlist’s ⋯ starts selecting, and offers removing from it', async ({ page }, info) => {
    const library = (await (await page.request.get(`${appApi}/api/library`)).json()) as {
      playlists: { id: number; kind: string; songCount: number }[]
    }
    const playlist = library.playlists.find(
      entry => entry.kind === 'manual' && entry.songCount >= 2,
    )
    test.skip(!playlist, 'needs a playlist you made with two songs')
    if (!playlist) return

    await page.goto(`/playlists/${playlist.id}`)
    const rows = songRows(page)
    await expect(rows.nth(1)).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('playlist-more').first().click()
    await page.getByRole('menuitem', { name: 'Select songs' }).click()
    const second = await titleOf(rows.nth(1))
    await page.getByRole('checkbox', { name: `Select ${second}` }).click()
    await expect(selectionCount(page, 1)).toBeVisible()

    // Removing from the playlist says so, and is not the library's red
    // remove. A phone's bar keeps it in More; leaving the page ends the
    // selection, so nothing is pressed that would change the playlist.
    if (info.project.name === 'phone') {
      await page.getByRole('button', { name: /^More$/ }).click()
      await expect(page.getByRole('menuitem', { name: 'Remove from this playlist' })).toBeVisible()
    } else {
      await expect(page.getByRole('button', { name: 'Remove from this playlist' })).toBeVisible()
      await page.getByRole('button', { name: /^Done selecting/ }).click()
      await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0)
    }
  })

  /**
   * A computer's keyboard selects too: the arrows move between rows with the
   * ring on the one you are on, Space ticks it, Enter plays it, ⌘A (Ctrl+A off
   * a Mac) selects every song, and Escape clears. It had gone in the UI
   * migration (Xiao, 2026-10-14). Space after a click is still play and pause,
   * and ⌘A in the search box selects its words.
   */
  test('the keyboard moves, ticks, selects all and plays', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'a phone has no keyboard to select with')
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page, 3)

    const rows = songRows(page)
    const pressOf = (index: number): Locator => rows.nth(index).locator('[data-row-press]')
    const second = await titleOf(rows.nth(1))
    const third = await titleOf(rows.nth(2))

    // Focus on the first row, as a click leaves it, then the arrows.
    await pressOf(0).focus()
    await page.keyboard.press('ArrowDown')
    await expect(pressOf(1)).toBeFocused()
    // The ring is drawn, now that the keyboard is moving focus: round the
    // whole row, not the part of it under the cover and title.
    await expect
      .poll(() => rows.nth(1).evaluate(el => getComputedStyle(el).outlineStyle))
      .toBe('solid')
    expect(await rows.nth(0).evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none')

    await page.keyboard.press('Space')
    await expect(page.getByRole('checkbox', { name: `Deselect ${second}` })).toBeVisible()
    await expect(selectionCount(page, 1)).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(pressOf(2)).toBeFocused()
    await page.keyboard.press('Space')
    await expect(selectionCount(page, 2)).toBeVisible()
    await page.keyboard.press('Space')
    await expect(page.getByRole('checkbox', { name: `Deselect ${third}` })).toHaveCount(0)
    await expect(selectionCount(page, 1)).toBeVisible()

    // Up and back: the arrows go both ways, and Escape clears.
    await page.keyboard.press('ArrowUp')
    await expect(pressOf(1)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0)

    // ⌘A: every song in the list, which the bar states as all of them.
    await page.keyboard.press('ControlOrMeta+a')
    const total = (await libraryData(page)).songs.length
    await expect(selectionCount(page, total)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0)

    // Enter is a plain click: it plays the row.
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('button', { name: new RegExp(`^Open now playing: ${escaped(second)}$`) }),
    ).toBeVisible()

    // After a click, with no ring, Space is play and pause, not a tick.
    await pressOf(1).click()
    await page.keyboard.press('Space')
    await expect(page.getByRole('button', { name: 'Play', exact: true }).last()).toBeVisible()
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0)

    // In the search box ⌘A selects the words, not the songs under it.
    await page.getByTestId('library-search').click()
    const box = page.getByRole('combobox', { name: /Search songs, playlists and tags/ })
    await box.fill('abc')
    await page.keyboard.press('ControlOrMeta+a')
    await expect.poll(() => box.evaluate(el => (el as HTMLInputElement).selectionEnd)).toBe(3)
    await page.keyboard.press('Escape')
    await expect(box).toBeHidden()
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0)
  })

  /**
   * The list is one Tab stop (a roving tabindex): Tab comes into it on a row,
   * the arrows move from row to row, ← and → along a row's own controls to
   * its ⋯, and Tab and Shift+Tab leave it from anywhere in a row. Every
   * control in every row used to be a stop of its own, so Tab could not get
   * past a library of any size (Xiao, 2026-10-14).
   */
  test('the list is one Tab stop, and ← → reach a row’s ⋯', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'a phone has no Tab key')
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page, 3)

    const grid = page.getByRole('grid', { name: /songs$/ })
    const rows = songRows(page)
    const pressOf = (index: number): Locator => rows.nth(index).locator('[data-row-press]')
    const third = await titleOf(rows.nth(2))
    // In a row, as opposed to the page's head, which scrolls inside the list too.
    const inRows = (): Promise<boolean> =>
      grid.evaluate(() => document.activeElement?.closest('[role="row"]') != null)
    /**
     * The control the browser should land on from the rows, either way: the
     * first one after them that Tab stops on, or the last one before them —
     * the page's head, which scrolls with the songs.
     */
    const besideRows = (after: boolean): Promise<string | null> =>
      grid.evaluate((list, forward) => {
        const rows = Array.from(list.querySelectorAll('[role="row"]'))
        const edge = forward ? rows[rows.length - 1] : rows[0]
        if (!edge) return null
        const all = Array.from(document.querySelectorAll<HTMLElement>('[tabindex], a, button'))
        const tabbable = all.filter(
          el =>
            el.tabIndex >= 0 &&
            el.closest('[role="row"]') === null &&
            el.getClientRects().length > 0 &&
            el.closest('[aria-hidden="true"]') === null &&
            (edge.compareDocumentPosition(el) &
              (forward ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING)) !==
              0,
        )
        const el = forward ? tabbable[0] : tabbable[tabbable.length - 1]
        if (!el) return null
        el.setAttribute('data-beside-rows', forward ? 'after' : 'before')
        return forward ? 'after' : 'before'
      }, after)

    // Tab from the top of the page reaches the list, and comes in on its first row.
    await page.getByTestId('library-search').focus()
    for (let press = 0; press < 40 && !(await inRows()); press += 1) {
      await page.keyboard.press('Tab')
    }
    await expect(pressOf(0)).toBeFocused()
    // One stop: no other row's controls are in Tab's way.
    expect(await grid.locator('[role="row"] [tabindex="0"]').count()).toBe(1)

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(pressOf(2)).toBeFocused()

    // → along the row to its ⋯, and ← back to the row itself.
    const more = rows.nth(2).getByRole('button', { name: `More actions for ${third}` })
    for (let press = 0; press < 8; press += 1) {
      if (await more.evaluate(el => el === document.activeElement)) break
      await page.keyboard.press('ArrowRight')
    }
    await expect(more).toBeFocused()
    await expect(more).toBeVisible()
    // Enter on the ⋯ opens the song's menu, as a click does; Escape closes it.
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('song-menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('song-menu')).toHaveCount(0)
    await more.focus()
    for (let press = 0; press < 8; press += 1) {
      if (await pressOf(2).evaluate(el => el === document.activeElement)) break
      await page.keyboard.press('ArrowLeft')
    }
    await expect(pressOf(2)).toBeFocused()
    // ⇧F10 opens the same menu from the row itself.
    await page.keyboard.press('Shift+F10')
    await expect(page.getByTestId('song-menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('song-menu')).toHaveCount(0)
    await pressOf(2).focus()

    // Tab leaves the list for the next control after it…
    expect(await besideRows(true)).toBe('after')
    await page.keyboard.press('Tab')
    expect(await inRows()).toBe(false)
    await expect(page.locator('[data-beside-rows="after"]')).toBeFocused()
    // …and Shift+Tab comes back in on the row it left.
    await page.keyboard.press('Shift+Tab')
    await expect(pressOf(2)).toBeFocused()

    // Shift+Tab from the row's ⋯ leaves backwards, not to the row itself.
    await more.focus()
    expect(await besideRows(false)).toBe('before')
    await page.keyboard.press('Shift+Tab')
    expect(await inRows()).toBe(false)
    await expect(page.locator('[data-beside-rows="before"]')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(pressOf(2)).toBeFocused()
  })

  /**
   * The list draws only the rows within a few screens of where it is
   * scrolled. The row the keyboard is on, scrolled past that, is taken out of
   * the page with its focus; scrolled back, it has the keyboard again, and an
   * arrow from the last row drawn draws the next one and moves to it. A short
   * window, so that a library of a hundred songs is long enough to show it.
   */
  test('the keyboard keeps its row through scrolling away and back', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'a phone has no keyboard to select with')
    // Thirty arrows and two scrolls a step at a time take a while.
    test.setTimeout(60_000)
    const { songs } = await libraryData(page)
    test.skip(
      songs.length < 90,
      'needs a library of 90 songs or more, longer than the rows a list draws at once',
    )
    await page.setViewportSize({ width: 1280, height: 420 })
    await openLibrary(page)
    await libraryReady(page)

    const grid = page.getByRole('grid', { name: /songs$/ })
    const pressAt = (position: number): Locator =>
      grid.locator(`[aria-rowindex="${position}"] [data-row-press]`)
    const inRows = (): Promise<boolean> =>
      page.evaluate(() => document.activeElement?.closest('[role="row"]') != null)
    const scroll = async (by: number): Promise<void> => {
      // A step at a time, as a wheel does, so the list follows each one.
      for (let step = 0; step < 14; step += 1) {
        await grid.evaluate((el, top) => el.scrollBy({ top }), by)
        await page.waitForTimeout(100)
      }
    }

    await page.getByTestId('library-search').focus()
    for (let press = 0; press < 40 && !(await inRows()); press += 1) {
      await page.keyboard.press('Tab')
    }
    for (let press = 0; press < 30; press += 1) await page.keyboard.press('ArrowDown')
    await expect(pressAt(31)).toBeFocused()

    await scroll(400)
    await expect(pressAt(31)).toHaveCount(0)
    await scroll(-400)
    await expect(pressAt(31)).toBeFocused()
    // It may be the last row drawn: the arrow draws the next and moves there.
    await page.keyboard.press('ArrowDown')
    await expect(pressAt(32)).toBeFocused()
  })

  /**
   * Tab comes back to the row the keyboard was last on even once the list has
   * scrolled so far away that it no longer draws that row: the list scrolls
   * back to it, and it has the keyboard, in view. It used to come in on the
   * first row in view instead. Either way in: Shift+Tab from after the list,
   * Tab from before it.
   */
  test('Tab comes back to a row scrolled far out of the drawn ones', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'a phone has no Tab key')
    test.setTimeout(60_000)
    const { songs } = await libraryData(page)
    test.skip(
      songs.length < 90,
      'needs a library of 90 songs or more, longer than the rows a list draws at once',
    )
    await page.setViewportSize({ width: 1280, height: 420 })
    await openLibrary(page)
    await libraryReady(page)

    const grid = page.getByRole('grid', { name: /songs$/ })
    const pressAt = (position: number): Locator =>
      grid.locator(`[aria-rowindex="${position}"] [data-row-press]`)
    const inRows = (): Promise<boolean> =>
      page.evaluate(() => document.activeElement?.closest('[role="row"]') != null)
    /** Whether the row is wholly inside the list's box: in view, not just drawn. */
    const shown = (position: number): Promise<boolean> =>
      grid.evaluate((list, at) => {
        const row = list.querySelector(`[aria-rowindex="${at}"]`)
        if (!row) return false
        const box = row.getBoundingClientRect()
        const frame = list.getBoundingClientRect()
        return box.height > 0 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1
      }, position)
    const scrollAway = async (): Promise<void> => {
      // A step at a time, as a wheel does, so the list follows each one.
      for (let step = 0; step < 14; step += 1) {
        await grid.evaluate(el => el.scrollBy({ top: 400 }))
        await page.waitForTimeout(100)
      }
      await expect(pressAt(31)).toHaveCount(0)
    }

    await page.getByTestId('library-search').focus()
    for (let press = 0; press < 40 && !(await inRows()); press += 1) {
      await page.keyboard.press('Tab')
    }
    for (let press = 0; press < 30; press += 1) await page.keyboard.press('ArrowDown')
    await expect(pressAt(31)).toBeFocused()

    // Out past the list, which then scrolls far away; Shift+Tab comes back to the row.
    await page.keyboard.press('Tab')
    expect(await inRows()).toBe(false)
    await scrollAway()
    await page.keyboard.press('Shift+Tab')
    await expect(pressAt(31)).toBeFocused()
    await expect.poll(() => shown(31)).toBe(true)

    // From before the list, Tab the same.
    await page.getByTestId('library-search').focus()
    await scrollAway()
    for (let press = 0; press < 40 && !(await inRows()); press += 1) {
      await page.keyboard.press('Tab')
    }
    await expect(pressAt(31)).toBeFocused()
    await expect.poll(() => shown(31)).toBe(true)
    // Still one stop: no other row's target is in Tab's way.
    expect(await grid.locator('[role="row"] [data-row-press][tabindex="0"]').count()).toBe(1)
  })

  /**
   * With a mouse, a ticked row dragged onto a playlist in the sidebar carries
   * every ticked song; it used to carry only the one under the pointer. The
   * playlist is put back as it was afterwards.
   */
  test('dragging one of the ticked songs carries all of them', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'a phone has no sidebar to drag to')
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page, 3)

    const library = (await (await page.request.get(`${appApi}/api/library`)).json()) as {
      playlists: { id: number; name: string; kind: string }[]
    }
    // A playlist you made that the sidebar lists: it shows the few you use.
    const sidebar = page.getByTestId('sidebar-playlists')
    let target: { id: number; name: string } | undefined
    for (const entry of library.playlists) {
      if (entry.kind !== 'manual') continue
      if ((await sidebar.getByRole('link', { name: entry.name, exact: true }).count()) > 0) {
        target = entry
        break
      }
    }
    test.skip(!target, 'needs a playlist you made in the sidebar')
    if (!target) return
    const link = sidebar.getByRole('link', { name: target.name, exact: true })
    const songsOf = async (): Promise<number[]> =>
      (
        (await (await page.request.get(`${appApi}/api/playlists/${target.id}/songs`)).json()) as {
          songIds: number[]
        }
      ).songIds
    const before = await songsOf()

    const rows = songRows(page)
    for (const index of [0, 1]) {
      await rows.nth(index).hover()
      await page.getByRole('checkbox', { name: `Select ${await titleOf(rows.nth(index))}` }).click()
    }
    await expect(selectionCount(page, 2)).toBeVisible()

    const from = (await rows.nth(1).boundingBox())!
    const to = (await link.boundingBox())!
    await page.mouse.move(from.x + from.width / 3, from.y + from.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 15; step += 1) {
      await page.mouse.move(
        from.x + from.width / 3 + ((to.x + 20 - from.x - from.width / 3) * step) / 15,
        from.y + from.height / 2 + ((to.y + to.height / 2 - from.y - from.height / 2) * step) / 15,
      )
      await page.waitForTimeout(20)
    }
    await page.mouse.up()
    await expect(page.getByText(`Added 2 songs to ${target.name}`)).toBeVisible()

    // Back as it was: the songs this run added, and only those.
    await expect.poll(async () => (await songsOf()).length).not.toBe(before.length)
    const added = (await songsOf()).filter(id => !before.includes(id))
    if (added.length > 0)
      await page.request.post(`${appApi}/api/playlists/${target.id}/songs/remove`, {
        data: { songIds: added },
      })
  })
})
