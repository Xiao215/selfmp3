import { expect, test } from '@playwright/test'

import { libraryReady, openLibrary, skipIfNoLibrary, songRows, titleOf } from './helpers.js'

/**
 * A song's ⋯ menu (docs/ui-mock `P14`): what is in it, in what order, the two
 * things it opens, and a right-click on a row opening it at the pointer.
 *
 * Nothing is edited. The menu is read; Song details opens the song's own page
 * (`/song/<id>`, `P15`), where Play next now lives and Fix metadata sits beside
 * the facts; and the tag picker is opened and closed without a tag being
 * ticked — the flow runs against a real library, and the one that tags songs is
 * the tag flow's business, not this one's.
 */
const ORDER = ['Tags', 'Add to playlist', 'Add to Up next', 'Play similar songs', 'Song details']

test.describe('the song menu', () => {
  test('lists its actions in order, and opens the song page and tags', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const title = await titleOf(songRows(page).first())
    await songRows(page).first().hover()
    await page.getByRole('button', { name: `More actions for ${title}` }).click()

    // The head: the song and its heart.
    const menu = page.getByTestId('song-menu')
    await expect(menu.getByText(title).first()).toBeVisible()
    await expect(menu.getByRole('button', { name: /^(Like|Unlike)$/ })).toBeVisible()

    // Each action present, and each below the one before it — read once the
    // sheet has stopped rising on a phone, or the later items are read higher
    // than the earlier ones only because the sheet moved in between.
    let settled = NaN
    await expect
      .poll(async () => {
        const before = settled
        settled = (await menu.boundingBox())?.y ?? NaN
        return settled === before
      })
      .toBe(true)
    let previousTop = -Infinity
    for (const label of ORDER) {
      // From the start of the name: a row's detail (the › of Add to playlist) is part of it.
      const item = page.getByRole('menuitem', { name: new RegExp(`^${label}`) })
      await expect(item).toBeVisible()
      const box = await item.boundingBox()
      expect(box, label).not.toBeNull()
      expect(box!.y, `${label} comes after the item before it`).toBeGreaterThan(previousTop)
      previousTop = box!.y
    }
    await expect(page.getByRole('menuitem', { name: /^Delete from library…$/ })).toBeVisible()
    // Gone from the menu: Play next and Select (P14), the instrumental switch, and
    // Fix metadata, which lives on the song's page.
    await expect(
      page.getByRole('menuitem', { name: /^(Play next|Select)$|instrumental|Fix metadata/i }),
    ).toHaveCount(0)

    await page.getByRole('menuitem', { name: 'Song details', exact: true }).click()
    await expect(page).toHaveURL(/\/song\/\d+$/)
    const song = page.getByTestId('song-screen')
    await expect(song).toBeVisible()
    await expect(song.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.getByTestId('song-play-next')).toBeVisible()
    await expect(song.getByRole('button', { name: /Fix song info/ })).toBeVisible()
    await page.goBack()

    await libraryReady(page)
    await songRows(page).first().hover()
    await page.getByRole('button', { name: `More actions for ${title}` }).click()
    await page.getByTestId('song-menu').getByRole('menuitem', { name: 'Tags', exact: true }).click()
    const search = page.getByPlaceholder('Search or create a tag…')
    await expect(search).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(search).toHaveCount(0)
  })

  test('a right-click on a row opens its menu where the pointer is', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'a right-click is a computer’s')
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const row = songRows(page).nth(1)
    const title = await titleOf(row)
    const box = await row.boundingBox()
    expect(box).not.toBeNull()
    const at = { x: box!.x + box!.width / 3, y: box!.y + box!.height / 2 }
    await page.mouse.click(at.x, at.y, { button: 'right' })

    const menu = page.getByTestId('song-menu')
    await expect(menu.getByText(title).first()).toBeVisible()
    // Hung from the pointer: its top-left corner near where the click was.
    await expect
      .poll(async () => {
        const shown = await menu.boundingBox()
        return shown ? Math.abs(shown.x - at.x) < 24 && shown.y > at.y - 8 : false
      })
      .toBe(true)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })
})
