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

  test('a phone reaches Tags and Settings from You, and comes back', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'You is a phone’s tab; a computer has the sidebar')
    await page.goto('/')
    await libraryReady(page)

    await page.getByRole('tab', { name: 'You', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'You', exact: true })).toBeVisible()
    await page.getByRole('link', { name: /^Tags/ }).click()
    await expect(page.getByRole('heading', { name: 'Tags', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back to You' }).click()
    await expect(page.getByRole('heading', { name: 'You', exact: true })).toBeVisible()

    await page.getByRole('link', { name: /^Settings/ }).click()
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
      timeout: 30_000,
    })
    // Settings is one of You's pages, so You stays lit.
    await expect(page.getByRole('tab', { name: 'You', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('a phone shows one tag’s songs from Tags', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'a computer picks tags from its sidebar')
    await page.goto('/tags')
    await expect(page.getByRole('heading', { name: 'Tags', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    // A chip in the picker names its song count: "chill, 20 songs".
    const tag = page.getByRole('button', { name: /, [\d,]+ songs?$/ }).first()
    const name = ((await tag.getAttribute('aria-label')) ?? '').split(',')[0] ?? ''
    await expect(tag.or(page.getByText(/No tags yet/))).toBeVisible({ timeout: 30_000 })
    test.skip(!(await tag.isVisible()), 'needs a tag in the dev library')

    // Tapping a tag no longer leaves the page: it goes into the bar along the
    // foot, which says what it comes to and is itself the way through.
    await tag.click()
    await expect(page.getByTestId('tags-play-bar')).toBeVisible()
    await page.getByTestId('tags-show-songs').click()

    await expect(page).toHaveURL(/\/$/)
    await libraryReady(page)
    // The library is showing that tag: the chip *is* the heading. Not Play —
    // a phone's library head has never carried the transport, which lives in
    // the bar on the page the tags were picked from.
    await expect(page.getByRole('heading').filter({ hasText: name })).toBeVisible()
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
