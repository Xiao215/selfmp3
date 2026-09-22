import { expect, test, type Page } from '@playwright/test'

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
 * A playlist's songs: the row they are drawn as, and putting them in order;
 * and a playlist's life: made with its first songs, never listed empty, and
 * with no pin or download button on its page (docs/UI-MIGRATION.md, Phase 5).
 *
 * The row is the point of the first test. A playlist used to draw a row of
 * its own, and the difference was everything a row is for — no ⋯ at a
 * finger's size, no colour under the song playing. There is one song row now,
 * drawn without tag chips as every row inside a place is, and this is what
 * says so from outside the code.
 *
 * The second is reordering, one gesture at every width: the row itself, held
 * until it lifts. It is checked by the order the page shows afterwards. The rows are put back where they were, so a run leaves
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

interface StoredPlaylist {
  id: number
  name: string
  songCount: number
}

async function playlistNamed(page: Page, name: string): Promise<StoredPlaylist | undefined> {
  const response = await page.request.get(`${appApi}/api/library`)
  const { playlists } = (await response.json()) as { playlists: StoredPlaylist[] }
  return playlists.find(entry => entry.name === name)
}

test.describe('a playlist’s songs', () => {
  test('are drawn as the library draws a song', async ({ page }) => {
    const name = await openOneYouMade(page)
    test.skip(name === null, 'needs a playlist you made with at least 3 songs')

    const row = songRows(page).first()
    const title = await titleOf(row)
    await row.hover()

    // The ⋯ a playlist's own row did without, at both widths.
    await expect(row.getByRole('button', { name: `More actions for ${title}` })).toBeAttached()
    // No tags inside a playlist, and so no dashed ＋ to add one (`S3`).
    await expect(row.getByRole('button', { name: `Edit tags for ${title}` })).toHaveCount(0)

    // No grip at any width: the row itself is the handle, held.
    await expect(row.getByRole('button', { name: gripName(title) })).toHaveCount(0)
  })

  test('go in the order you put them in', async ({ page }) => {
    const name = await openOneYouMade(page)
    test.skip(name === null, 'needs a playlist you made with at least 3 songs')

    const before = await order(page)
    const rows = songRows(page)
    const first = (await rows.nth(0).boundingBox())!
    const second = (await rows.nth(1).boundingBox())!
    const rowHeight = second.y - first.y

    // The row is the handle at every width now: held still it lifts, and then
    // it follows. The grip a mouse used to drag by is gone (Xiao, 2026-09-21).
    const move = async (from: number, rowsDown: number): Promise<void> => {
      const row = songRows(page).nth(from)
      const box = (await row.boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2

      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.waitForTimeout(600)
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

test.describe('a playlist', () => {
  test('has no pin or download button; its ⋯ holds the rest', async ({ page }) => {
    const name = await openOneYouMade(page)
    test.skip(name === null, 'needs a playlist you made with at least 3 songs')

    await expect(page.getByTestId('playlist-download')).toHaveCount(0)
    await expect(page.getByTestId('playlist-downloaded')).toHaveCount(0)
    await page.getByTestId('playlist-more').first().click()
    const menu = page.getByTestId('playlist-menu')
    await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /pin/i })).toHaveCount(0)
  })

  test('is made with its first songs, and cancelling makes nothing', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const name = `Flow — new ${Date.now()}`
    const start = async (): Promise<void> => {
      await page.goto('/playlists')
      await page.getByTestId('playlists-new').click()
      await page.getByRole('textbox', { name: 'Playlist name' }).fill(name)
      await page.getByTestId('new-playlist-next').click()
      await expect(page.getByTestId('add-songs')).toBeVisible()
    }

    // Named and picking, it does not exist yet; cancelled, it never will.
    await start()
    expect(await playlistNamed(page, name)).toBeUndefined()
    await page.getByTestId('add-songs').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('add-songs')).toHaveCount(0)
    expect(await playlistNamed(page, name)).toBeUndefined()

    await start()
    await page.getByTestId('add-songs').getByRole('button', { name: /^Add / }).first().click()
    await page.getByTestId('add-songs-create').click()
    await expect(page).toHaveURL(/\/playlists\/\d+/)
    await expect.poll(async () => (await playlistNamed(page, name))?.songCount).toBe(1)
    const made = await playlistNamed(page, name)
    if (made) await page.request.delete(`${appApi}/api/playlists/${made.id}`)
  })

  test('is not listed while it is empty', async ({ page }) => {
    const name = `Flow — empty ${Date.now()}`
    const created = await page.request.post(`${appApi}/api/playlists`, {
      data: { name, kind: 'manual' },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: number }
    try {
      await page.goto('/playlists')
      // Loaded: the line under the title has counted them, or found none.
      await expect(page.getByText(/ playlists? · |None of your own yet/)).toBeVisible({
        timeout: 30_000,
      })
      // The grid's tiles, not the sidebar, which is not this page.
      const tiles = page.locator('[data-testid^="playlist-row-"]')
      await expect(tiles.filter({ hasText: name })).toHaveCount(0)
    } finally {
      await page.request.delete(`${appApi}/api/playlists/${id}`)
    }
  })
})
