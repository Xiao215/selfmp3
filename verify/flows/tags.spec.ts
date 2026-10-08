import { expect, test, type Page } from '@playwright/test'

import {
  escaped,
  libraryData,
  libraryReady,
  openLibrary,
  skipIfNoLibrary,
  songRows,
  type LibrarySong,
  type LibraryTag,
} from './helpers.js'

/**
 * Tags as places (docs/UI-MIGRATION.md, Phase 4; docs/ui-mock `P07`).
 *
 * A tag is somewhere to go, not a filter the app switches on for you: All
 * tags lists every one, most played first, and a tile opens the tag's own page
 * at `/tag/<name>`. While songs have no tag the page leads with a card for
 * them. Nothing is edited here; making and renaming tags is the navigation
 * flow's and the mutations flow's.
 *
 * The library's own tag strip is the one place a tag is still a filter, and
 * the second half checks the rule it rests on: several tags mean *any* of
 * them, so every tag added makes the list longer.
 */

/**
 * The tags in All tags' order: by the plays of the songs each carries, then
 * the biggest, then by name — `tagsMostPlayed` in `features/tag/tag.model.ts`.
 */
function mostPlayed(tags: LibraryTag[], songs: LibrarySong[]): LibraryTag[] {
  const present = songs.filter(song => !song.missing)
  const standing = (tag: LibraryTag) => {
    const carrying = present.filter(song => song.tagIds.includes(tag.id))
    return {
      tag,
      plays: carrying.reduce((sum, song) => sum + song.playCount, 0),
      size: carrying.length,
    }
  }
  return tags
    .map(standing)
    .sort((a, b) => b.plays - a.plays || b.size - a.size || a.tag.name.localeCompare(b.tag.name))
    .map(entry => entry.tag)
}

async function openAllTags(page: Page): Promise<void> {
  await page.goto('/tags')
  await expect(page.getByRole('heading', { name: 'Tags', exact: true })).toBeVisible({
    timeout: 30_000,
  })
}

test.describe('tags as places', () => {
  test('All tags lists every tag, most played first', async ({ page }) => {
    await openAllTags(page)
    const { songs, tags } = await libraryData(page)
    test.skip(tags.length === 0, 'needs a tag in the dev library')

    await expect(
      page.getByText(`${tags.length} ${tags.length === 1 ? 'tag' : 'tags'} · most played first`),
    ).toBeVisible()
    await expect(page.getByTestId(/^tags-row-\d+$/)).toHaveCount(tags.length)
    const first = mostPlayed(tags, songs)[0]
    if (first) {
      await expect(page.getByTestId('tags-row-0')).toHaveAccessibleName(
        new RegExp(`^${escaped(first.name)}, `),
      )
    }
    // The page's own filter and its way across to the library's picker are
    // gone. With a pointer the housekeeping is a tile's ⋯ and right-click, so
    // the footnote about holding (a finger's only way in) is not shown.
    await expect(page.getByTestId('tags-pick-to-listen')).toHaveCount(0)
    await expect(page.getByText('Hold a tag to rename, recolour or delete it.')).toHaveCount(0)
  })

  /**
   * A tag's page is that one tag (docs/features/lists.md, B1). Combining from
   * it opens the combination as a page of its own over it, so the tag page
   * never turns into something else, and Back finds it as it was.
   */
  test('Combine with… opens the tags together over the tag’s page', async ({ page }) => {
    const { songs, tags } = await libraryData(page)
    const present = songs.filter(song => !song.missing)
    const used = mostPlayed(tags, songs).filter(tag =>
      present.some(song => song.tagIds.includes(tag.id)),
    )
    const [first, second] = used
    test.skip(!first || !second, 'needs two tags with songs')
    if (!first || !second) return

    await page.goto(`/tag/${encodeURIComponent(first.name)}`)
    const name = page.locator('[data-testid="place-name"]:visible')
    await expect(name).toHaveText(first.name, { timeout: 30_000 })
    // One tag: no chips to take off, no Save; Combine with… instead.
    await expect(page.locator('[data-testid="place-add"]:visible')).toHaveCount(0)
    await expect(page.getByText('Save as playlist')).toHaveCount(0)

    await page.locator('[data-testid="place-combine"]:visible').click()
    const sheet = page.getByTestId('add-sheet')
    await sheet.getByText(second.name, { exact: true }).first().click()
    await sheet.getByTestId('add-sheet-show').click()

    await expect(page).toHaveURL(/\/combined\?/)
    await expect(name).toHaveText(`${first.name} or ${second.name}`)
    await expect(page.locator('[data-testid="place-add"]:visible')).toBeVisible()

    await page.getByRole('button', { name: 'Back', exact: true }).locator('visible=true').click()
    await expect(page).toHaveURL(/\/tag\/[^/]+$/)
    await expect(name).toHaveText(first.name)
  })

  test('a row opens the tag’s own page, not a filtered library', async ({ page }) => {
    await openAllTags(page)
    const { songs, tags } = await libraryData(page)
    const first = mostPlayed(tags, songs)[0]
    test.skip(!first, 'needs a tag in the dev library')
    if (!first) return

    await page.getByTestId('tags-row-0').click()
    await expect(page).toHaveURL(/\/tag\/[^/]+$/)
    expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(`/tag/${first.name}`)
  })

  test('the untagged card is there exactly while some songs have no tag', async ({
    page,
  }, info) => {
    await openAllTags(page)
    const { songs } = await libraryData(page)
    const untagged = songs.filter(song => !song.missing && song.tagIds.length === 0).length

    if (untagged === 0) {
      await expect(page.getByTestId('tags-untagged')).toHaveCount(0)
      return
    }
    const card = page.getByTestId('tags-untagged')
    await expect(card).toBeVisible()
    await expect(card).toContainText(
      `${untagged} ${untagged === 1 ? 'song has' : 'songs have'} no tag yet`,
    )
    // A computer's card names who the songs are by and has a button that tags
    // them while they play; a phone's whole card is that button.
    if (info.project.name === 'desktop') {
      await expect(card.getByTestId('tags-untagged-start')).toHaveText('Tag while they play')
    } else {
      await expect(card).toHaveAccessibleName(/Tag them one at a time, while they play$/)
    }
  })
})

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
    .getByRole('button', { name: new RegExp(`^${escaped(name)}(,|$)`) })
    .first()
    .click()
  await panel.getByTestId('listen-tags-done').click()
  await expect(panel).toHaveCount(0)
}

test.describe('the library’s tag strip, still a filter', () => {
  test('a second tag adds songs rather than taking them away', async ({ page }, info) => {
    test.skip(
      info.project.name === 'phone',
      'checked on a computer; the test below covers both widths',
    )
    await openLibrary(page)
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
    // "All" is how the strip is cleared; there has never been a button by that
    // name, and this test only skipped until a library had two overlapping tags.
    await page.getByTestId('library-tag-all').click()
    await expect(page.getByTestId('library-play-tags')).toHaveCount(0)
    await expect(page.getByTestId('library-match-note')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /^Library/ })).toBeVisible()
  })

  /**
   * At both widths, because this is what the phone was missing: it could pick
   * tags and then had nowhere on the page to start them — Play was drawn only
   * above the breakpoint. No Save: tags played together are saved from Up
   * next, once heard (docs/features/lists.md; the follows flow).
   */
  test('the head offers Play only once a tag is on, and no Save', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const { songs, tags } = await libraryData(page)
    const used = tags.find(tag => songs.some(song => !song.missing && song.tagIds.includes(tag.id)))
    test.skip(!used, 'needs a tag with songs')
    if (!used) return

    // Nothing chosen: an unfiltered Play would mean "play the whole library
    // alphabetically", so there is none.
    await expect(page.getByTestId('library-play-tags')).toHaveCount(0)

    await pickTag(page, used.name)
    await expect(page.getByTestId('library-play-tags')).toBeVisible()
    await expect(page.getByTestId('library-save-tags')).toHaveCount(0)
    // And the songs themselves are on the same screen, under the picker,
    // rather than behind a count that opens another page.
    await expect(songRows(page).first()).toBeVisible()
  })
})

/**
 * A row's tag chips (E1, docs/features/tagging.md): a chip opens its tag's
 * page in Library as everywhere else — the strip is what filters — and a row
 * never shows the chip of a tag the list is filtered by.
 */
test.describe('a song row’s tag chips', () => {
  test('a chip opens its tag, and the tag filtered by is not drawn', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const rows = songRows(page)
    // A tag some row on screen wears as a chip.
    const { tags } = await libraryData(page)
    let name: string | null = null
    for (const tag of tags) {
      if ((await rows.getByRole('button', { name: tag.name, exact: true }).count()) > 0) {
        name = tag.name
        break
      }
    }
    test.skip(name === null, 'needs a song row with a tag')
    if (name === null) return

    await pickTag(page, name)
    await expect(rows.first()).toBeVisible()
    await expect(rows.getByRole('button', { name, exact: true })).toHaveCount(0)

    await page.getByTestId('library-tag-all').click()
    await rows.getByRole('button', { name, exact: true }).first().click()
    await expect(page).toHaveURL(new RegExp(`/tag/${encodeURIComponent(name)}$`))
  })
})
