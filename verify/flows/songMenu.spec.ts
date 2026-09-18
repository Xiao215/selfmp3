import { expect, test } from '@playwright/test'

import { libraryReady, openLibrary, skipIfNoLibrary, songRows, titleOf } from './helpers.js'

/**
 * A song's ⋯ menu: what is in it, in what order, and the two things it opens.
 *
 * Nothing is edited. The menu is read, Similar songs is opened in place, Song
 * details is opened (with Fix metadata inside it) and closed, and
 * the tag picker is opened and closed without a tag being ticked — the flow
 * runs against a real library, and the one that tags songs is the tag flow's
 * business, not this one's.
 */
const ORDER = [
  'Play next',
  'Add to queue',
  'Similar songs',
  'Add to playlist…',
  'Edit tags…',
  'Song details…',
]

test.describe('the song menu', () => {
  test('lists the web’s actions in order, and opens details and tags', async ({ page }) => {
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page)

    const title = await titleOf(songRows(page).first())
    await songRows(page).first().hover()
    await page.getByRole('button', { name: `More actions for ${title}` }).click()

    // Each action present, and each below the one before it.
    let previousTop = -Infinity
    for (const label of ORDER) {
      // From the start of the name: a row's detail (the › of Similar songs) is part of it.
      const item = page.getByRole('menuitem', { name: new RegExp(`^${label}`) })
      await expect(item).toBeVisible()
      const box = await item.boundingBox()
      expect(box, label).not.toBeNull()
      expect(box!.y, `${label} comes after the item before it`).toBeGreaterThan(previousTop)
      previousTop = box!.y
    }
    await expect(page.getByRole('menuitem', { name: /^Remove from library…$/ })).toBeVisible()
    // Gone from the menu: the instrumental switch, and Fix metadata, which lives in details.
    await expect(page.getByRole('menuitem', { name: /instrumental|Fix metadata/i })).toHaveCount(0)

    // The similar pair opens under its row, in place.
    await page.getByRole('menuitem', { name: /^Similar songs/ }).click()
    await expect(page.getByRole('menuitem', { name: 'Play similar', exact: true })).toBeVisible()
    await expect(
      page.getByRole('menuitem', { name: 'Add similar to queue', exact: true }),
    ).toBeVisible()

    await page.getByRole('menuitem', { name: 'Song details…', exact: true }).click()
    const details = page.getByRole('dialog').filter({ hasText: 'History' })
    await expect(details).toBeVisible()
    await expect(details.getByText(title).first()).toBeVisible()
    await expect(details.getByText(/^Sound$/i)).toBeVisible()
    await expect(details.getByRole('button', { name: /Fix metadata/ })).toBeVisible()
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
