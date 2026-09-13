import { expect, test, type APIRequestContext } from '@playwright/test'

import { libraryReady, skipIfNoLibrary } from './helpers.js'

/**
 * Editing a smart playlist's rules: the count follows the edit, and the edit
 * is saved once typing pauses.
 *
 * The flow makes its own smart playlist through the API and deletes it at the
 * end, so the reference playlists are never touched.
 */

const API = process.env.SELFMP3_APP_API ?? ''

interface Playlist {
  id: number
  rules: { rules: { field: string; value?: number }[] } | null
}

async function playlist(request: APIRequestContext, id: number): Promise<Playlist | undefined> {
  const response = await request.get(`${API}/api/playlists`)
  return ((await response.json()) as Playlist[]).find(entry => entry.id === id)
}

test.describe('smart playlist rules', () => {
  test('the count follows an edit, and the edit is saved', async ({ page }) => {
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const created = await page.request.post(`${API}/api/playlists`, {
      data: {
        name: `Flow — rules ${Date.now()}`,
        kind: 'smart',
        rules: {
          match: 'all',
          rules: [{ field: 'duration', op: 'gt', value: 1 }],
          orderBy: 'addedAt',
          order: 'desc',
          limit: null,
        },
      },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: number }

    try {
      const songs = await page.request.get(`${API}/api/playlists/${id}/songs`)
      const { songIds } = (await songs.json()) as { songIds: number[] }
      test.skip(songIds.length === 0, 'needs songs longer than a second')

      await page.goto(`/playlists/${id}`)
      await page.getByRole('button', { name: 'Edit rules' }).click()
      // The number and the words are separate text, so read the live region
      // that holds both.
      const count = page.locator('[aria-live="polite"]').filter({ hasText: /match/ })
      await expect(count).toContainText(songIds.length.toLocaleString('en-US'))
      await expect(count).toContainText(/songs? match/)

      // Nothing is a day long.
      const value = page.getByLabel('Value', { exact: true })
      await value.fill('86400')
      await expect(count).toContainText('Nothing matches yet')
      await expect
        .poll(async () => (await playlist(page.request, id))?.rules?.rules[0]?.value)
        .toBe(86400)

      // Only closing is checked here. The old app does not reload the song list
      // after saving rules, but the new one does.
      await page.getByRole('button', { name: 'Done' }).click()
      await expect(page.getByRole('button', { name: 'Edit rules' })).toBeVisible()
    } finally {
      await page.request.delete(`${API}/api/playlists/${id}`)
    }
  })
})
