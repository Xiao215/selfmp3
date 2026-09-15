import { expect, test, type Locator } from '@playwright/test'

import { libraryReady, skipIfNoLibrary, songRows, titleOf } from './helpers.js'

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
test.describe('selecting songs', () => {
  test('select two, see the count, select all, and get out again', async ({ page }, info) => {
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page, 2)

    const rows = songRows(page)
    // What is drawn, which is not the library: a long list draws a screenful
    // or so. The library's own count is the one select-all states.
    const drawn = await rows.count()
    const stated = async (control: Locator): Promise<number> => {
      const name = await control.evaluate(el => el.getAttribute('aria-label') ?? el.textContent ?? '')
      return Number(/^Select all (\d+) /.exec(name)?.[1])
    }
    const first = await titleOf(rows.nth(0))
    const second = await titleOf(rows.nth(1))

    await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0)

    if (info.project.name === 'phone') {
      // Held, the way a thumb does it: the row's own press, kept down.
      const box = (await page
        .getByRole('button', { name: new RegExp(`^${first}, `) })
        .first()
        .boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(700)
      await page.mouse.up()
      await expect(page.getByText('1 selected', { exact: true })).toBeVisible()
    } else {
      await rows.nth(0).hover()
      await page.getByRole('checkbox', { name: `Select ${first}` }).click()
    }
    await page.getByRole('checkbox', { name: `Select ${second}` }).click()
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible()

    // Select-all spells out what "all" is. A phone's bar is one line of icons,
    // and select-all is the first thing in its More.
    let total: number
    if (info.project.name === 'phone') {
      await page.getByRole('button', { name: /^More$/ }).click()
      const selectAll = page.getByRole('menuitem', { name: /^Select all \d+ songs? in your library$/ })
      total = await stated(selectAll)
      await selectAll.click()
      await expect(page.getByText(`${total} selected`, { exact: true })).toBeVisible()
    } else {
      const selectAll = page.getByRole('checkbox', { name: /^Select all \d+ songs? in your library$/ })
      total = await stated(selectAll)
      await selectAll.click()
      await expect(page.getByText(`${total} selected`, { exact: true })).toBeVisible()
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
    const api = process.env.SELFMP3_APP_API ?? new URL(page.url()).origin
    const library = (await (await page.request.get(`${api}/api/library`)).json()) as {
      songs: unknown[]
    }
    expect(library.songs).toHaveLength(total)
  })
})
