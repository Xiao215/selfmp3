import { expect, test, type Page } from '@playwright/test'

import { libraryReady, skipIfNoLibrary, songRows } from './helpers.js'

/**
 * Choosing tags to listen to.
 *
 * The rule the whole library rests on is that several tags mean *any* of them:
 * every tag you add makes the list longer, so a run of taps can be a mood
 * rather than a search that narrows to nothing. That is the surprising half —
 * it is the opposite of what a filter usually does — so it is what this
 * checks, along with the promise that follows from it: the songs carrying all
 * the chosen tags are still there, and they lead.
 *
 * Nothing is edited. Choosing tags is client-side, and the playlist the head
 * can save is a separate flow.
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

/**
 * Turn a tag on through the head's own picker.
 *
 * Not by clicking the tag's name anywhere on the page: a song row wears its
 * tags as chips too, so "the button called chill" is ambiguous and the first
 * one is usually in the list, under a title that swallows the click. The
 * picker is also the path a person takes at two hundred tags.
 */
async function pickTag(page: Page, name: string): Promise<void> {
  const panel = page.getByTestId('listen-tags')
  if ((await panel.count()) === 0) await page.getByTestId('library-add-tag').click()
  await panel.getByTestId('listen-tags-search').fill(name)
  // A chip in the picker carries its song count in its name — "chill, 20 songs" —
  // so this matches the start of it rather than the whole.
  await panel
    .getByRole('button', { name: new RegExp(`^${name}(,|$)`) })
    .first()
    .click()
  await panel.getByTestId('listen-tags-done').click()
  await expect(panel).toHaveCount(0)
}

test.describe('choosing tags', () => {
  test('a second tag adds songs rather than taking them away', async ({ page }, info) => {
    test.skip(
      info.project.name === 'phone',
      'a phone chooses tags on its own Tags page, not in the library head',
    )
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const { songs, tags } = await libraryData(page)
    const present = songs.filter(song => !song.missing)
    const count = (id: number) => present.filter(song => song.tagIds.includes(id)).length

    // Two tags that overlap without being the same set: then "both" is a real
    // subset of the union, and the note under the head has something to say.
    const pair = tags
      .flatMap(a => tags.filter(b => b.id !== a.id).map(b => [a, b] as const))
      .find(([a, b]) => {
        const both = present.filter(s => s.tagIds.includes(a.id) && s.tagIds.includes(b.id)).length
        const union = present.filter(s => s.tagIds.includes(a.id) || s.tagIds.includes(b.id)).length
        return both > 0 && both < union && count(a.id) > 0 && count(b.id) > 0
      })
    test.skip(!pair, 'needs two overlapping tags')
    if (!pair) return

    const [first, second] = pair
    const union = present.filter(
      s => s.tagIds.includes(first.id) || s.tagIds.includes(second.id),
    ).length
    const both = present.filter(
      s => s.tagIds.includes(first.id) && s.tagIds.includes(second.id),
    ).length

    await pickTag(page, first.name)
    await expect(songRows(page)).toHaveCount(count(first.id))

    await pickTag(page, second.name)
    // The union, which is more than either tag alone — never fewer.
    await expect(songRows(page)).toHaveCount(union)
    expect(union).toBeGreaterThanOrEqual(count(first.id))

    // And the head says where the songs that are both have gone.
    await expect(page.getByTestId('library-match-note')).toContainText(
      `${both} have both tags, and come first`,
    )

    // Clearing puts the whole library back. Not asserted as a row count: the
    // list is virtualised, so what is rendered is whatever fits, and the panel
    // opening and closing changes that. What is checked is that the view is no
    // longer a tag pick at all.
    await page.getByRole('button', { name: 'clear tags', exact: true }).click()
    await expect(page.getByTestId('library-play-tags')).toHaveCount(0)
    await expect(page.getByTestId('library-match-note')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /^Library/ })).toBeVisible()
  })

  test('the head offers Play only once a tag is on', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'the head’s buttons are a computer’s')
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const { songs, tags } = await libraryData(page)
    const used = tags.find(tag => songs.some(song => !song.missing && song.tagIds.includes(tag.id)))
    test.skip(!used, 'needs a tag with songs')
    if (!used) return

    // Nothing chosen: an unfiltered Play would mean "play the whole library
    // alphabetically", so there is none.
    await expect(page.getByTestId('library-play-tags')).toHaveCount(0)
    await expect(page.getByTestId('library-save-tags')).toHaveCount(0)

    await pickTag(page, used.name)
    await expect(page.getByTestId('library-play-tags')).toBeVisible()
    await expect(page.getByTestId('library-save-tags')).toBeVisible()
  })
})
