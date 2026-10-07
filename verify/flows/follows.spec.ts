import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { appApi } from '../env.js'
import {
  escaped,
  libraryData,
  libraryReady,
  openLibrary,
  skipIfNoLibrary,
  type LibraryTag,
} from './helpers.js'

/**
 * A playlist that fills from tags: saving one, editing it, and stopping.
 *
 * The one thing here that could lose somebody's music is **Stop filling**.
 * A following playlist's songs are the answer to its tags and are stored
 * nowhere, so switching it off has to write them down first — and this is the
 * flow that proves it did, through the real server rather than against a
 * repository in memory.
 *
 * Each test makes its own playlist and deletes it at the end, so the reference
 * playlists are never touched.
 */

interface Playlist {
  id: number
  name: string
  kind: 'manual' | 'live'
  rules: { rules: { field: string; tagId?: number }[] } | null
}

async function playlist(request: APIRequestContext, id: number): Promise<Playlist | undefined> {
  const response = await request.get(`${appApi}/api/playlists`)
  return ((await response.json()) as Playlist[]).find(entry => entry.id === id)
}

async function songIdsOf(request: APIRequestContext, id: number): Promise<number[]> {
  const response = await request.get(`${appApi}/api/playlists/${id}/songs`)
  return ((await response.json()) as { songIds: number[] }).songIds
}

/** A tag with songs, and a second one that would add more. */
async function twoTags(page: Page): Promise<readonly [LibraryTag, LibraryTag] | null> {
  const { songs, tags } = await libraryData(page)
  const present = songs.filter(song => !song.missing)
  const has = (id: number) => present.filter(song => song.tagIds.includes(id)).length
  const first = tags.find(tag => has(tag.id) > 0)
  const second = tags.find(
    tag =>
      tag.id !== first?.id &&
      present.some(song => song.tagIds.includes(tag.id) && !song.tagIds.includes(first?.id ?? -1)),
  )
  return first && second ? [first, second] : null
}

test.describe('a playlist that fills from tags', () => {
  /**
   * Tags played together are saved from Up next, once heard
   * (docs/features/lists.md): Up next is named after them, Save makes a
   * playlist that fills from them, and the button then says it is saved.
   */
  test('tags played together are saved from Up next, and it fills from them', async ({
    page,
  }, info) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const pair = await twoTags(page)
    test.skip(!pair, 'needs two tags with songs')
    if (!pair) return
    const [first, second] = pair

    await page.getByTestId('library-add-tag').click()
    const picker = page.getByTestId('listen-tags')
    for (const tag of [first, second]) {
      await picker.getByTestId('listen-tags-search').fill(tag.name)
      await picker
        .getByRole('button', { name: new RegExp(`^${escaped(tag.name)}(,|$)`) })
        .first()
        .click()
    }
    await picker.getByTestId('listen-tags-done').click()
    await page.getByTestId('library-play-tags').click()

    await page
      .getByTestId(info.project.name === 'phone' ? 'mini-player-queue' : 'player-bar-queue')
      .click()
    const name = `${first.name} or ${second.name}`
    await expect(page.locator('[data-testid="up-next-source-name"]:visible')).toHaveText(name)
    await page.locator('[data-testid="up-next-save"]:visible').click()

    // The message says what happened, and the button says it is done.
    await expect(page.getByText(/^Saved “/)).toBeVisible()
    await expect(page.locator('[data-testid="up-next-saved"]:visible')).toBeVisible()

    const made = await page.request.get(`${appApi}/api/playlists`)
    const all = (await made.json()) as Playlist[]
    const created = all.find(entry => entry.name === name)
    expect(created, `a playlist named ${name}`).toBeDefined()
    if (!created) return

    try {
      expect(created.kind).toBe('live')
      expect(created.rules?.rules.map(rule => rule.tagId)).toEqual([first.id, second.id])
    } finally {
      await page.request.delete(`${appApi}/api/playlists/${created.id}`)
    }
  })

  test('the Fills from row adds a tag, and Stop filling keeps every song', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const pair = await twoTags(page)
    test.skip(!pair, 'needs two tags with songs')
    if (!pair) return
    const [first, second] = pair

    const created = await page.request.post(`${appApi}/api/playlists`, {
      data: {
        name: `Flow — follows ${Date.now()}`,
        kind: 'live',
        rules: {
          match: 'any',
          rules: [{ field: 'tag', op: 'has', tagId: first.id }],
          orderBy: 'addedAt',
          order: 'desc',
          limit: null,
        },
      },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: number }

    try {
      const before = await songIdsOf(page.request, id)
      test.skip(before.length === 0, 'needs a tag with songs')

      await page.goto(`/playlists/${id}`)
      await expect(page.getByTestId('follows-row')).toBeVisible()

      // Add a second tag through the same chooser the library head uses.
      await page.getByTestId('follows-add-tag').click()
      const panel = page.getByTestId('listen-tags')
      await panel.getByTestId('listen-tags-search').fill(second.name)
      await panel
        .getByRole('button', { name: new RegExp(`^${escaped(second.name)}(,|$)`) })
        .first()
        .click()

      await expect.poll(async () => (await playlist(page.request, id))?.rules?.rules.length).toBe(2)
      const widened = await songIdsOf(page.request, id)
      // Any of the tags, so the list can only have grown.
      expect(widened.length).toBeGreaterThanOrEqual(before.length)

      await page.getByTestId('listen-tags-done').click()
      await page.getByTestId('stop-following').click()

      await expect.poll(async () => (await playlist(page.request, id))?.kind).toBe('manual')
      const after = await songIdsOf(page.request, id)
      // The whole point: the songs are still there, and it is no longer a rule.
      const ascending = (ids: number[]) => [...ids].sort((a, b) => a - b)
      expect(ascending(after)).toEqual(ascending(widened))
      await expect(page.getByTestId('follows-row')).toHaveCount(0)
    } finally {
      await page.request.delete(`${appApi}/api/playlists/${id}`)
    }
  })
})
