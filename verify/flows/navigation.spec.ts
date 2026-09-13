import { expect, test } from '@playwright/test'

import { libraryReady } from './helpers.js'

/**
 * Getting to the other screens.
 *
 * Thin on purpose. Its job is to prove that each screen's queries still answer
 * after the move — a screen that renders its frame and never its content is the
 * shape a broken query hook takes — not to test what is on them.
 *
 * Settings earns its line: `useSettings` is the query the phone calls
 * `useServerSettings`, and phase 1 made those one hook.
 */
test.describe('navigation', () => {
  test('playlists', async ({ page }) => {
    await page.goto('/playlists')
    await expect(page.getByRole('heading', { name: /playlists/i })).toBeVisible({
      timeout: 30_000,
    })
  })

  test('settings loads the server’s own settings', async ({ page }) => {
    await page.goto('/settings')
    // Any control here means the settings query answered; an unanswered one
    // leaves the section headings with nothing under them.
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
      timeout: 30_000,
    })
    // As long as the heading: the settings query answers within a second, but
    // the dev build draws this page in about 3 s alone and 5 to 7 s in the
    // middle of a full run, past the 5 s default.
    await expect(
      page
        .getByRole('spinbutton')
        .or(page.getByRole('checkbox'))
        .or(page.getByRole('switch'))
        .first(),
    ).toBeVisible({ timeout: 30_000 })
  })

  test('the library is still there afterwards', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
      timeout: 30_000,
    })
    await page.goto('/')
    await libraryReady(page)
  })
})
