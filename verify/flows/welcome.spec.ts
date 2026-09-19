import { expect, test } from '@playwright/test'

/**
 * Getting in (docs/ui-mock `P01`, `C01`): a device with no library opens on
 * Welcome, and Welcome has one way in.
 *
 * A fresh context with nothing stored, rather than the configuration's, which
 * seeds the server's address so every other flow has a library. Nothing here
 * presses the button: signing in to Google is a person's to do.
 */
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('welcome', () => {
  test('a device with no library opens on Welcome, with one Google button', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/welcome$/, { timeout: 30_000 })

    const google = page.getByRole('button', { name: 'Continue with Google' })
    await expect(google).toBeVisible()
    await expect(google).toHaveCount(1)
    await expect(page.getByRole('button', { name: /google/i })).toHaveCount(1)

    // No page title asks to sign in: Welcome's heading is a welcome.
    await expect(page.getByRole('heading', { name: /sign in/i })).toHaveCount(0)
    // And none of the app is behind it: no tab bar, no sidebar, no player.
    await expect(page.getByTestId('home-screen')).toHaveCount(0)
  })

  test('a link into the app goes to Welcome instead', async ({ page }) => {
    await page.goto('/library')
    await expect(page).toHaveURL(/\/welcome$/, { timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  })
})
