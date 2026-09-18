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

  test("a phone's search circle opens Library with its search box ready", async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== 'phone',
      "the circle is a phone's; a computer has ⌘K and the rail",
    )
    await page.goto('/')
    await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('tab-search').click()
    await expect(page).toHaveURL(/\/library/)
    await libraryReady(page)
    await expect(page.getByRole('textbox', { name: 'Search library' })).toBeFocused()
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

  test('a phone reaches Tags and Settings from You, and comes back', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'phone',
      'You is behind a phone’s avatar; a computer has the sidebar',
    )
    await page.goto('/')
    await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 })

    // You is the avatar in Home's header.
    await page.getByTestId('home-you').click()
    await expect(page.getByRole('heading', { name: 'You', exact: true })).toBeVisible()
    await page.getByRole('link', { name: /^Tags/ }).click()
    await expect(page.getByRole('heading', { name: 'Tags', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back to You' }).click()
    await expect(page.getByRole('heading', { name: 'You', exact: true })).toBeVisible()

    await page.getByRole('link', { name: /^Settings/ }).click()
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
   * The Tags page is housekeeping now, not a second picker.
   *
   * It used to be where a phone picked what to listen to, which put the
   * library's main verb two taps under You and then showed no songs when you
   * used it. Picking moved to the library's own picker at both widths; what is
   * left here is naming, colouring and deleting, and a way across to the
   * picker for anyone who came looking for the old page.
   */
  test('a phone manages tags on the Tags page, and is sent to the library to pick', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'phone', 'a computer edits tags from its sidebar')
    await page.goto('/tags')
    await expect(page.getByRole('heading', { name: 'Tags', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    // Making a tag is a card in the page, not a bare field over the picker.
    await page.getByTestId('tags-new').click()
    await expect(page.getByTestId('tags-new-name')).toBeVisible()
    // Nothing typed, nothing to create.
    await expect(page.getByTestId('tags-create')).toBeDisabled()
    await page.getByRole('button', { name: 'Close new tag' }).click()

    // A tag is a row that opens the editor, not a chip that starts music.
    const row = page.getByRole('button', { name: /^Edit .+, [\d,]+ songs?$/ }).first()
    await expect(row.or(page.getByText(/No tags yet/))).toBeVisible({ timeout: 30_000 })
    if (await row.isVisible()) {
      await row.click()
      await expect(page.getByTestId('tag-editor')).toBeVisible()
      await page.keyboard.press('Escape')
    }

    await page.getByTestId('tags-pick-to-listen').click()
    await expect(page).toHaveURL(/\/library$/)
    await libraryReady(page)
    // The library arrives with its picker already down, where the songs are.
    await expect(page.getByTestId('listen-tags')).toBeVisible()
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
