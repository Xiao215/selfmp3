import { expect, test, type Page } from '@playwright/test'

import { libraryReady, skipIfNoLibrary, songRows } from './helpers.js'

/**
 * Filtering the library by tag, both ways: one tag shown only, another hidden.
 *
 * The two apps reach "hidden" by different routes at desktop width — the old
 * app's sidebar has a hide button per tag, while a phone holds the chip and
 * picks "Hide these" from the editor it opens — so the flow takes whichever
 * the page offers. What must match is the result: the heading names both,
 * the list is the songs with one tag and without the other, and clearing
 * brings the whole library back.
 *
 * Nothing is edited. Filtering is client-side and the editor is closed by
 * choosing a filter, not by renaming or deleting anything.
 */

interface LibraryTag {
  id: number
  name: string
}
interface LibrarySong {
  tagIds: number[]
  missing: boolean
}

async function libraryData(page: Page): Promise<{ songs: LibrarySong[]; tags: LibraryTag[] }> {
  const api = process.env.SELFMP3_APP_API ?? ''
  const response = await page.request.get(`${api}/api/library`)
  return (await response.json()) as { songs: LibrarySong[]; tags: LibraryTag[] }
}

async function hideTag(page: Page, name: string): Promise<void> {
  const sidebarHide = page.getByRole('button', { name: `Hide songs tagged ${name}` }).first()
  if (await sidebarHide.isVisible().catch(() => false)) {
    await sidebarHide.click()
    return
  }
  const chip = page.getByRole('button', { name, exact: true }).first()
  const box = await chip.boundingBox()
  if (!box) throw new Error(`No chip for tag ${name}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // Longer than the 450 ms hold that opens the editor.
  await page.waitForTimeout(700)
  await page.mouse.up()
  await page.getByRole('button', { name: /Hide these/ }).click()
}

test.describe('tag filters', () => {
  test('show only one tag, hide another, then clear', async ({ page }, info) => {
    test.skip(
      info.project.name === 'phone',
      'a phone library has no tag chips: tags filter on a computer',
    )
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const { songs, tags } = await libraryData(page)
    const present = songs.filter(song => !song.missing)
    const count = (id: number) => present.filter(song => song.tagIds.includes(id)).length
    // A pair where "A but not B" is some songs and not all of A's.
    const pair = tags
      .flatMap(a => tags.filter(b => b.id !== a.id).map(b => [a, b] as const))
      .find(([a, b]) => {
        const left = present.filter(s => s.tagIds.includes(a.id) && !s.tagIds.includes(b.id))
        return left.length > 0 && left.length < count(a.id)
      })
    test.skip(!pair, 'needs two overlapping tags')
    if (!pair) return
    const [shown, hidden] = pair
    const expected = present.filter(
      s => s.tagIds.includes(shown.id) && !s.tagIds.includes(hidden.id),
    ).length
    const total = await songRows(page).count()

    await page.getByRole('button', { name: shown.name, exact: true }).first().click()
    await expect(songRows(page)).toHaveCount(count(shown.id))

    await hideTag(page, hidden.name)
    await expect(
      page.getByRole('heading', { name: `${shown.name} · not ${hidden.name}` }),
    ).toBeVisible()
    await expect(songRows(page)).toHaveCount(expected)
    await expect(page.getByText('Filtered by')).toBeVisible()

    await page.getByRole('button', { name: 'clear', exact: true }).click()
    await expect(songRows(page)).toHaveCount(total)
    await expect(page.getByText('Filtered by')).toHaveCount(0)
  })
})
