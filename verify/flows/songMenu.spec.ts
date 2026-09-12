import { expect, test } from '@playwright/test'

import { libraryReady, skipIfNoLibrary, songRows, titleOf } from './helpers.js'

/**
 * A song's ⋯ menu: what is in it, in what order, and the two things it opens.
 *
 * Nothing is edited. The menu is read, Song details is opened and closed, and
 * the tag picker is opened and closed without a tag being ticked — the flow
 * runs against a real library, and the one that tags songs is the tag flow's
 * business, not this one's.
 */
const ORDER = [
  'Play next',
  'Add to queue',
  'Play similar',
  'Add similar to queue',
  'Edit tags…',
  'Add to playlist…',
  'Song details',
]

test.describe('the song menu', () => {
  test('lists the web’s actions in order, and opens details and tags', async ({ page }) => {
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const title = await titleOf(songRows(page).first())
    await songRows(page).first().hover()
    await page.getByRole('button', { name: `More actions for ${title}` }).click()

    // Each action present, and each below the one before it.
    let previousTop = -Infinity
    for (const label of ORDER) {
      const item = page.getByRole('menuitem', { name: label, exact: true })
      await expect(item).toBeVisible()
      const box = await item.boundingBox()
      expect(box, label).not.toBeNull()
      expect(box!.y, `${label} comes after the item before it`).toBeGreaterThan(previousTop)
      previousTop = box!.y
    }
    await expect(page.getByRole('menuitem', { name: /^Remove from library…$/ })).toBeVisible()

    await page.getByRole('menuitem', { name: 'Song details', exact: true }).click()
    const details = page.getByRole('dialog').filter({ hasText: 'History' })
    await expect(details).toBeVisible()
    await expect(details.getByText(title).first()).toBeVisible()
    await expect(details.getByText(/^Sound$/i)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(details).toHaveCount(0)

    await songRows(page).first().hover()
    await page.getByRole('button', { name: `More actions for ${title}` }).click()
    await page.getByRole('menuitem', { name: 'Edit tags…', exact: true }).click()
    const search = page.getByPlaceholder('Search or create a tag…')
    await expect(search).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(search).toHaveCount(0)
  })
})
