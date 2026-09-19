import { expect, test } from '@playwright/test'

import { libraryReady, openLibrary } from './helpers.js'

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
  /**
   * The app opens on Home (docs/ui-mock `P04`, `C03`): a greeting, one search
   * field, and Library one tap away. On a phone the bar is Home · Library ·
   * Playlists with a search circle beside it.
   */
  test('a fresh launch lands on Home, and Library is one tap away', async ({ page }, info) => {
    await page.goto('/')
    await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByRole('heading', { name: /^Good (morning|afternoon|evening|night)\.$/ }),
    ).toBeVisible()
    await expect(page.getByTestId('home-search')).toBeVisible()

    if (info.project.name === 'phone') {
      for (const tab of ['Home', 'Library', 'Playlists']) {
        await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible()
      }
      await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await page.getByRole('tab', { name: 'Library', exact: true }).click()
    } else {
      await page.getByTestId('nav-library').click()
    }
    await expect(page).toHaveURL(/\/library$/)
    await libraryReady(page)
  })

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

  test('a phone reaches Stats and Settings from You, and comes back', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'phone',
      'You is behind a phone’s avatar; a computer has the sidebar',
    )
    await page.goto('/')
    await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 })

    // You is the avatar in Home's header (`P31`): the person, this month as one
    // card that opens Stats, then Import, Report and Settings.
    await page.getByTestId('home-you').click()
    await expect(page.getByTestId('you-screen')).toBeVisible()
    await expect(page.getByTestId('you-import')).toBeVisible()
    await expect(page.getByTestId('you-report')).toBeVisible()
    // Tags is Home's, through its tiles and "All N tags"; not a row here.
    await expect(page.getByTestId('you-tags')).toHaveCount(0)

    await page.getByTestId('you-stats').click()
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: 'Back to You', exact: true }).click()
    await expect(page.getByTestId('you-screen')).toBeVisible()

    await page.getByTestId('you-settings').click()
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
      timeout: 30_000,
    })
    // Settings is reached from Home, through You, so Home stays lit.
    await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  /**
   * All tags keeps the housekeeping the page used to be, behind a hold: the
   * new-tag card from the + in its header, and the editor on a held row. The
   * way across to the library's picker is gone; a row opens the tag's page.
   */
  test('All tags makes a tag from its +, and edits one held', async ({ page }) => {
    await page.goto('/tags')
    await expect(page.getByRole('heading', { name: 'Tags', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    // Making a tag is a card in the page, not a bare field over the rows.
    await page.getByTestId('tags-new').click()
    await expect(page.getByTestId('tags-new-name')).toBeVisible()
    // Nothing typed, nothing to create.
    await expect(page.getByTestId('tags-create')).toBeDisabled()
    await page.getByRole('button', { name: 'Close new tag' }).click()

    const row = page.getByTestId('tags-row-0')
    await expect(row.or(page.getByText(/No tags yet/))).toBeVisible({ timeout: 30_000 })
    if (await row.isVisible()) {
      // Held, not tapped: a tap opens the tag's page.
      await row.hover()
      await page.mouse.down()
      await page.waitForTimeout(700)
      await page.mouse.up()
      await expect(page.getByTestId('tag-editor')).toBeVisible()
      await page.keyboard.press('Escape')
    }
  })

  test('the library is still there afterwards', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
      timeout: 30_000,
    })
    await openLibrary(page)
    await libraryReady(page)
  })
})
