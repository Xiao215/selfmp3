import { expect, test, type Page } from '@playwright/test'

import { escaped, songRows, titleOf } from './helpers.js'

/**
 * A playlist's songs: the row they are drawn as, and putting them in order.
 *
 * The row is the point of the first test. A playlist used to draw a row of
 * its own, and the difference was everything a row is for — no heart, no ⋯ at
 * a finger's size, no tag chips. There is one song row now, and this is what
 * says so from outside the code.
 *
 * The second is reordering, which is two gestures for one thing: at desktop
 * width a grip a mouse drags, on a phone the row itself, held. Both end in
 * the same request, so both are checked the same way — by the order the page
 * shows afterwards. The rows are put back where they were, so a run leaves
 * the library as it found it and the next run starts from the same place.
 */

/**
 * The grip's name, anchored.
 *
 * A role's name matches on a substring, and a loved song's heart is "Remove
 * <title> from loved" — which contains "move <title>". Unanchored, the grip's
 * locator found the heart, and a flow that thought it was dragging a row was
 * dragging a heart.
 */
function gripName(title: string): RegExp {
  return new RegExp(`^Move ${escaped(title)}$`)
}

/** The titles on the page, top to bottom. */
async function order(page: Page): Promise<string[]> {
  const rows = songRows(page)
  const count = await rows.count()
  const titles: string[] = []
  for (let index = 0; index < count; index += 1) titles.push(await titleOf(rows.nth(index)))
  return titles
}

/** A playlist you made, with enough songs to move one about. Null when there is none. */
async function openOneYouMade(page: Page): Promise<string | null> {
  await page.goto('/playlists')
  const tiles = page.locator('[data-testid^="playlist-row-"]')
  await expect(tiles.first()).toBeVisible({ timeout: 30_000 })
  const howMany = await tiles.count()

  for (let index = 0; index < howMany; index += 1) {
    // A fresh load each time: the router keeps the pages you have been on
    // mounted behind the one you are looking at, so anything read off the
    // whole page could as easily be the last playlist's.
    if (index > 0) await page.goto('/playlists')
    const tile = page.locator(`[data-testid="playlist-row-${index}"]`)
    // One that follows tags wears the badge, and its order is the rule's.
    if (await tile.getByText(/follows tags/).count()) continue
    const name = (await tile.getAttribute('aria-label')) ?? ''
    if (!name) continue

    await tile.click()
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 })
    if ((await songRows(page).count()) < 3) continue
    // Three songs that can be told apart, so a move is visible in the order.
    const top = await order(page)
    if (new Set(top.slice(0, 3)).size === 3) return name
  }
  return null
}

test.describe('a playlist’s songs', () => {
  test('are drawn as the library draws a song', async ({ page }, info) => {
    const name = await openOneYouMade(page)
    test.skip(name === null, 'needs a playlist you made with at least 3 songs')

    const row = songRows(page).first()
    const title = await titleOf(row)
    await row.hover()

    // The heart and the ⋯ a playlist's own row did without, at both widths.
    // The heart says which way it would go, so a loved song's reads the other way.
    const heart = new RegExp(`^(Love ${escaped(title)}|Remove ${escaped(title)} from loved)$`)
    await expect(row.getByRole('button', { name: heart })).toBeAttached()
    await expect(row.getByRole('button', { name: `More actions for ${title}` })).toBeAttached()

    const grip = row.getByRole('button', { name: gripName(title) })
    if (info.project.name === 'phone') {
      // No grip: the row is the handle, held. The tag column is the library's
      // at this width too, which is to say there is not one.
      await expect(grip).toHaveCount(0)
    } else {
      // The tags and the dashed ＋, which only a row this wide has room for.
      await expect(row.getByRole('button', { name: `Edit tags for ${title}` })).toBeAttached()
      await expect(grip).toBeVisible()
    }
  })

  test('go in the order you put them in', async ({ page }, info) => {
    const name = await openOneYouMade(page)
    test.skip(name === null, 'needs a playlist you made with at least 3 songs')

    const before = await order(page)
    const rows = songRows(page)
    const first = (await rows.nth(0).boundingBox())!
    const second = (await rows.nth(1).boundingBox())!
    const rowHeight = second.y - first.y

    const move = async (from: number, rowsDown: number): Promise<void> => {
      const row = songRows(page).nth(from)
      const title = await titleOf(row)
      const box = (await row.boundingBox())!
      let x = box.x + box.width / 2
      let y = box.y + box.height / 2

      if (info.project.name === 'phone') {
        // The row is the handle: held still, it lifts, and then it follows.
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.waitForTimeout(600)
      } else {
        const grip = (await row.getByRole('button', { name: gripName(title) }).boundingBox())!
        x = grip.x + grip.width / 2
        y = grip.y + grip.height / 2
        await page.mouse.move(x, y)
        await page.mouse.down()
      }
      for (let step = 1; step <= 10; step += 1) {
        await page.mouse.move(x, y + (rowHeight * rowsDown * step) / 10)
        await page.waitForTimeout(20)
      }
      await page.mouse.up()
    }

    await move(0, 2)
    const after = await order(page)
    expect(after).not.toEqual(before)
    expect(after[2]).toBe(before[0])
    // Nothing was lost or gained on the way.
    expect([...after].sort()).toEqual([...before].sort())

    // Put it back, and prove the way back is the same way.
    await move(2, -2)
    await expect
      .poll(async () => (await order(page)).join('|'), { timeout: 15_000 })
      .toBe(before.join('|'))
  })
})
