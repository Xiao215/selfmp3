import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { libraryReady, skipIfNoLibrary } from './helpers.js'

/**
 * A playlist that follows tags: saving one, editing it, and stopping.
 *
 * The one thing here that could lose somebody's music is **Stop following**.
 * A following playlist's songs are the answer to its tags and are stored
 * nowhere, so switching it off has to write them down first — and this is the
 * flow that proves it did, through the real server rather than against a
 * repository in memory.
 *
 * Each test makes its own playlist and deletes it at the end, so the reference
 * playlists are never touched.
 */

const API = process.env.SELFMP3_APP_API ?? ''

interface Playlist {
  id: number
  name: string
  kind: 'manual' | 'live'
  rules: { rules: { field: string; tagId?: number }[] } | null
}

interface LibraryTag {
  id: number
  name: string
}
interface LibrarySong {
  tagIds: number[]
  missing: boolean
}

async function playlist(request: APIRequestContext, id: number): Promise<Playlist | undefined> {
  const response = await request.get(`${API}/api/playlists`)
  return ((await response.json()) as Playlist[]).find(entry => entry.id === id)
}

async function songIdsOf(request: APIRequestContext, id: number): Promise<number[]> {
  const response = await request.get(`${API}/api/playlists/${id}/songs`)
  return ((await response.json()) as { songIds: number[] }).songIds
}

async function libraryData(page: Page): Promise<{ songs: LibrarySong[]; tags: LibraryTag[] }> {
  const response = await page.request.get(`${API}/api/library`)
  return (await response.json()) as { songs: LibrarySong[]; tags: LibraryTag[] }
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

test.describe('a playlist that follows tags', () => {
  test('saving the chosen tags makes one, and it follows them', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'the head’s Save is a computer’s')
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const pair = await twoTags(page)
    test.skip(!pair, 'needs a tag with songs')
    if (!pair) return
    const [tag] = pair

    await page.getByTestId('library-add-tag').click()
    const picker = page.getByTestId('listen-tags')
    await picker.getByTestId('listen-tags-search').fill(tag.name)
    await picker.getByRole('button', { name: tag.name, exact: true }).first().click()
    await page.keyboard.press('Escape')
    await page.getByTestId('library-save-tags').click()

    // The message says what happened, and the button stops offering.
    await expect(page.getByText(/^Saved “/)).toBeVisible()
    await expect(page.getByTestId('library-saved')).toBeVisible()

    const made = await page.request.get(`${API}/api/playlists`)
    const all = (await made.json()) as Playlist[]
    const created = all.find(entry => entry.name === tag.name)
    expect(created, `a playlist named ${tag.name}`).toBeDefined()
    if (!created) return

    try {
      expect(created.kind).toBe('live')
      expect(created.rules?.rules.map(rule => rule.tagId)).toEqual([tag.id])
    } finally {
      await page.request.delete(`${API}/api/playlists/${created.id}`)
    }
  })

  test('the Follows row adds a tag, and Stop following keeps every song', async ({ page }) => {
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const pair = await twoTags(page)
    test.skip(!pair, 'needs two tags with songs')
    if (!pair) return
    const [first, second] = pair

    const created = await page.request.post(`${API}/api/playlists`, {
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
      await panel.getByRole('button', { name: second.name, exact: true }).first().click()

      await expect.poll(async () => (await playlist(page.request, id))?.rules?.rules.length).toBe(2)
      const widened = await songIdsOf(page.request, id)
      // Any of the tags, so the list can only have grown.
      expect(widened.length).toBeGreaterThanOrEqual(before.length)

      await page.keyboard.press('Escape')
      await page.getByTestId('stop-following').click()

      await expect.poll(async () => (await playlist(page.request, id))?.kind).toBe('manual')
      const after = await songIdsOf(page.request, id)
      // The whole point: the songs are still there, and it is no longer a rule.
      const ascending = (ids: number[]) => [...ids].sort((a, b) => a - b)
      expect(ascending(after)).toEqual(ascending(widened))
      await expect(page.getByTestId('follows-row')).toHaveCount(0)
    } finally {
      await page.request.delete(`${API}/api/playlists/${id}`)
    }
  })
})
