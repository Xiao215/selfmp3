import { expect, test, type Page } from '@playwright/test'

/**
 * The tag inbox: a song without a tag is listed, tagged from the inbox one at a
 * time, and the inbox is empty again.
 *
 * The reference library has every song tagged, so the flow takes the tags off
 * one song through the API first and puts them back afterwards whatever
 * happens. Play along is switched off in both apps' storage, so tagging does
 * not start any music.
 */

const API = process.env.SELFMP3_APP_API ?? 'http://localhost:4600'

interface LibrarySong {
  id: number
  title: string
  tagIds: number[]
  missing?: boolean
}

async function setTags(page: Page, songId: number, tagIds: number[]): Promise<void> {
  const response = await page.request.put(`${API}/api/songs/${songId}/tags`, { data: { tagIds } })
  expect(response.ok()).toBe(true)
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test.describe('the tag inbox', () => {
  test('tag an untagged song one at a time, and see the inbox empty', async ({ page }) => {
    test.setTimeout(90_000)
    const library = (await (await page.request.get(`${API}/api/library`)).json()) as {
      songs: LibrarySong[]
      tags: { id: number; name: string }[]
    }
    test.skip(
      library.songs.some(song => song.tagIds.length === 0 && !song.missing),
      'the library already has untagged songs, so "empty" cannot be checked',
    )
    const song = library.songs.find(item => item.tagIds.length === 1 && !item.missing)
    test.skip(!song, 'no song carries exactly one tag')
    const target = song as LibrarySong
    const tag = library.tags.find(item => item.id === target.tagIds[0])
    test.skip(!tag, 'the song’s tag is not in the library')

    await setTags(page, target.id, [])
    try {
      await page.goto('/')
      await page.evaluate(() => {
        localStorage.setItem('selfmp3:triage-play-along', 'false')
        localStorage.setItem('selfmp3.triage-play-along', 'false')
      })
      await page.goto('/inbox')
      await expect(page.getByRole('heading', { name: 'Untagged', exact: true })).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByText('1 song without a tag', { exact: false })).toBeVisible()

      await page.getByRole('button', { name: 'Start tagging' }).click()
      const chips = page.getByRole('group', { name: `Tags for ${target.title}` })
      await chips.getByRole('button', { name: new RegExp(`${escaped(tag!.name)}$`) }).click()
      await page.getByRole('button', { name: 'Finish' }).click()
      await expect(page.getByText('Tagged 1 of 1')).toBeVisible()

      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(page.getByText('All tagged')).toBeVisible({ timeout: 15_000 })
    } finally {
      await setTags(page, target.id, target.tagIds)
    }
  })
})
