import { expect, test } from '@playwright/test'

import { libraryReady, rowFor, skipIfNoLibrary } from './helpers.js'

/**
 * Fixing a song's metadata: open it from the song's menu, look at the
 * suggestions and the changes one would make, untick them all, and cancel.
 *
 * Nothing is applied. The lookup runs on the Mac against iTunes and
 * MusicBrainz; when neither answers with anything, the flow skips rather than
 * fail on a network it does not own. Desktop, where the ⋯ hangs off the row.
 */
const SONG = 'アイドル'

test.describe('fixing metadata', () => {
  test('review a suggestion’s changes, untick them, and cancel', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'the row menu is a desktop hover here')
    test.setTimeout(90_000)
    await page.goto('/')
    await libraryReady(page)
    await skipIfNoLibrary(page)
    test.skip((await rowFor(page, SONG).count()) === 0, `${SONG} is not in this library`)

    await rowFor(page, SONG).hover()
    await rowFor(page, SONG)
      .getByRole('button', { name: `More actions for ${SONG}` })
      .click()
    await page.getByRole('menuitem', { name: /Fix metadata/ }).click()

    const dialog = page.getByRole('dialog', { name: 'Fix metadata' })
    await expect(dialog).toBeVisible()
    const firstSuggestion = dialog.getByRole('radio').first()
    const found = await firstSuggestion
      .waitFor({ timeout: 60_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!found, 'neither iTunes nor MusicBrainz answered')

    const changes = dialog.getByText(/changes to apply/i)
    if (await changes.isVisible().catch(() => false)) {
      await dialog.getByRole('button', { name: 'select none' }).click()
      await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
    } else {
      await expect(dialog.getByText('This suggestion matches what you already have.')).toBeVisible()
    }

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  })
})
