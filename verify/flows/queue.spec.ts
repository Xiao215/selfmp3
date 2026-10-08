import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  libraryReady,
  openLibrary,
  playSong,
  shuffleLibrary,
  skipIfNoLibrary,
  songRows,
} from './helpers.js'

/**
 * Up next (docs/ui-mock `P25`, `C11`, `C12`).
 *
 * On a computer it is a rail beside the page, toggled from the player bar and
 * left open across pages: the playing song on top, then what is next. A song
 * comes out by its right-click menu or by Delete on the focused row, and the
 * Undo in the toast puts it back where it was. The drag out of the rail does
 * the same through the same removal; it is left to a hand, since a flow that
 * drags a pointer out of a scroll view tests the harness as much as the app.
 *
 * On a phone it is a sheet over the mini player and the tab bar, opened from
 * the mini player; swiping a row left removes it with the same Undo, and
 * Clear the rest takes everything but the song playing, with Undo too.
 *
 * A song played on its own from Library ends in silence, as it should, and Up
 * next says so and offers what could come next (docs/features/lists.md).
 */

/**
 * A few seconds of silence, served for every song, so one ends while the flow
 * waits: the dev library's songs are minutes long.
 */
function shortSilence(seconds: number): Buffer {
  const rate = 8000
  const samples = rate * seconds
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + samples * 2, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24)
  wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  return wav
}

const RAIL = 'the rail is the computer layout'
const SHEET = 'the sheet is the phone layout'

/** Shuffle the library, so Up next has songs after the one playing. */
async function startPlaying(page: Page): Promise<void> {
  await openLibrary(page)
  await libraryReady(page)
  await skipIfNoLibrary(page, 3)
  await shuffleLibrary(page)
}

/** A row's accessible name: "<title>, <artist>". */
async function nameOf(row: Locator): Promise<string> {
  return (await row.getAttribute('aria-label')) ?? ''
}

test.describe('up next on a computer', () => {
  test('opens from the player bar with the playing song on top, and stays open', async ({
    page,
  }, info) => {
    test.skip(info.project.name === 'phone', RAIL)
    await startPlaying(page)
    const toggle = page.getByTestId('player-bar-queue')
    const rail = page.getByTestId('queue-rail')

    await toggle.click()
    await expect(rail).toBeVisible()
    const first = rail.locator('[data-testid^="queue-row-"]').first()
    await expect(first).toHaveAttribute('aria-label', /^Playing /)
    await expect(rail.getByTestId('queue-row-1')).toBeVisible()

    // Auto-mix, on its own line in the rail: it says what the next handover
    // will be, and goes back to queue order when it is switched off.
    const autoMix = rail.getByLabel('Auto-mix', { exact: true })
    await expect(rail.getByText('plays in order')).toBeVisible()
    await autoMix.click()
    await expect(rail.getByText(/^(next crossfade \d+s|nothing to mix yet)$/)).toBeVisible()
    await autoMix.click()
    await expect(rail.getByText('plays in order')).toBeVisible()

    // Across pages: the rail is the frame's, not the page's.
    await page.getByTestId('nav-home').click()
    await expect(page).toHaveURL(/\/$/)
    await expect(rail).toBeVisible()

    await toggle.click()
    await expect(rail).toBeHidden()
  })

  test('says once how a song comes out, and never again on this device', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', RAIL)
    await startPlaying(page)
    await page.getByTestId('player-bar-queue').click()
    const rail = page.getByTestId('queue-rail')
    const hint = page.getByTestId('queue-rail-hint')
    await expect(hint).toHaveText(/Drag a song out to remove it/)

    // Anything done in the rail puts it away.
    await rail.getByTestId('queue-row-1').click()
    await expect(hint).toBeHidden()

    // Remembered on this device: a fresh start does not show it again.
    await startPlaying(page)
    await page.getByTestId('player-bar-queue').click()
    await expect(rail.getByTestId('queue-row-1')).toBeVisible()
    await expect(hint).toHaveCount(0)
  })

  test('a row held and moved lands where it was let go, far down a long queue', async ({
    page,
  }, info) => {
    test.skip(info.project.name === 'phone', RAIL)
    await startPlaying(page)
    await skipIfNoLibrary(page, 12)
    await page.getByTestId('player-bar-queue').click()
    const rail = page.getByTestId('queue-rail')
    await expect(rail.getByTestId('queue-row-1')).toBeVisible()

    // The rail draws only the rows in view, so scroll to its end first: the
    // rows there are drawn as they arrive, and a move among them has to land.
    const rows = rail.locator('[data-testid^="queue-row-"]')
    const count = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="queue-rail"]')
      const list = [...(el?.querySelectorAll('div') ?? [])].find(
        div => div.scrollHeight > div.clientHeight && getComputedStyle(div).overflowY !== 'visible',
      )
      if (list) list.scrollTop = list.scrollHeight
      return list ? Math.round(list.scrollHeight / 44) : 0
    })
    expect(count).toBeGreaterThan(10)
    const last = Math.max(
      ...(await rows.evaluateAll(all =>
        all.map(row => Number(row.getAttribute('data-testid')?.replace('queue-row-', ''))),
      )),
    )
    const from = last - 2
    const row = rail.getByTestId(`queue-row-${from}`)
    await expect(row).toBeVisible()
    const name = await nameOf(row)

    const box = (await row.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    // Past the hold (`MOVE_MS.hold`), then two rows up in small steps.
    await page.waitForTimeout(700)
    for (let step = 1; step <= 10; step++) await page.mouse.move(x, y - (2 * 44 * step) / 10)
    await page.mouse.up()

    await expect(rail.getByTestId(`queue-row-${from - 2}`)).toHaveAttribute('aria-label', name)
  })

  test('a song comes out by its menu or by Delete, and Undo puts it back', async ({
    page,
  }, info) => {
    test.skip(info.project.name === 'phone', RAIL)
    await startPlaying(page)
    await page.getByTestId('player-bar-queue').click()
    const rail = page.getByTestId('queue-rail')
    const next = rail.getByTestId('queue-row-1')
    const name = await nameOf(next)
    expect(name).not.toBe('')
    const song = rail.getByRole('button', { name, exact: true })
    const undo = page.getByRole('button', { name: 'Undo', exact: true })

    // The right-click menu.
    await next.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove from Up next' }).click()
    await expect(song).toHaveCount(0)
    await undo.click()
    await expect(song).toHaveCount(1)
    await expect(rail.getByTestId('queue-row-1')).toHaveAttribute('aria-label', name)

    // Delete on the focused row, which draws nothing but the toast.
    await rail.getByTestId('queue-row-1').focus()
    await page.keyboard.press('Delete')
    await expect(song).toHaveCount(0)
    await undo.click()
    await expect(rail.getByTestId('queue-row-1')).toHaveAttribute('aria-label', name)
  })
})

test.describe('up next on a phone', () => {
  test('opens from the mini player over the mini player and the tab bar', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'phone', SHEET)
    await startPlaying(page)
    await page.getByTestId('mini-player-queue').click()
    const sheet = page.getByTestId('queue-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('Up next', { exact: true })).toBeVisible()
    await expect(sheet.getByTestId('queue-row-1')).toBeVisible()

    // What a finger would touch where the mini player and the tab bar were is
    // the sheet: it covers them, it does not sit between them.
    for (const id of ['mini-player', 'tab-home']) {
      const box = await page.getByTestId(id).boundingBox()
      if (!box) continue
      const covered = await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest('[data-testid="queue-sheet"]') !== null,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      )
      expect(covered, `${id} is under the sheet`).toBe(true)
    }

    await sheet.getByRole('button', { name: 'Close Up next' }).first().click()
    await expect(sheet).toBeHidden()
    await expect(page.getByTestId('mini-player')).toBeVisible()
  })

  test('a row swiped left comes out, and Undo puts it back', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', SHEET)
    await startPlaying(page)
    await page.getByTestId('mini-player-queue').click()
    const sheet = page.getByTestId('queue-sheet')
    const row = sheet.getByTestId('queue-row-1')
    await expect(row).toBeVisible()
    const name = await nameOf(row.getByRole('button').first())
    const song = sheet.getByRole('button', { name, exact: true })

    // The sheet rises before its rows hold still; a swipe begun while it is
    // still moving starts somewhere else by the time it is read.
    await page.waitForTimeout(400)
    // Sideways first, so it is the row's and not the list's; past 30 % of it.
    const box = (await row.boundingBox())!
    const y = box.y + box.height / 2
    const x = box.x + box.width * 0.55
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(x - (box.width * 0.45 * step) / 10, y)
      await page.waitForTimeout(20)
    }
    await page.mouse.up()

    await expect(song).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(song).toHaveCount(1)
  })

  test('Clear the rest keeps the song playing, and Undo puts the rest back', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'phone', SHEET)
    await startPlaying(page)
    await page.getByTestId('mini-player-queue').click()
    const sheet = page.getByTestId('queue-sheet')
    const next = sheet.getByTestId('queue-row-1')
    await expect(next).toBeVisible()
    const name = await nameOf(next.getByRole('button').first())

    await sheet.getByTestId('queue-clear-rest').click()
    await expect(page.getByText(/^Cleared \d+ songs?$/)).toBeVisible()
    await expect(next).toHaveCount(0)
    // The song playing stays, and so do the sheet and the mini player under it.
    await expect(sheet.getByRole('button', { name: /^Playing / })).toBeVisible()
    await expect(page.getByTestId('mini-player')).toBeAttached()

    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(sheet.getByTestId('queue-row-1').getByRole('button').first()).toHaveAttribute(
      'aria-label',
      name,
    )
  })
})

test.describe('a song played on its own', () => {
  test('ends with what could come next', async ({ page }, info) => {
    const silence = shortSilence(3)
    await page.route('**/api/stream/**', route =>
      route.fulfill({ status: 200, contentType: 'audio/wav', body: silence }),
    )
    await openLibrary(page)
    await libraryReady(page)
    await skipIfNoLibrary(page, 2)
    await playSong(page, songRows(page).first())

    // It ends, nothing follows, and the app says so where Up next opens from.
    await expect(page.getByText('That was the only song')).toBeVisible({ timeout: 15_000 })
    const phone = info.project.name === 'phone'
    await page.getByTestId(phone ? 'mini-player-queue' : 'player-bar-queue').click()
    const surface = page.getByTestId(phone ? 'queue-sheet' : 'queue-rail')
    const card = surface.getByTestId('only-song-end')
    await expect(card).toBeVisible()

    await card.getByTestId('only-song-shuffle').click()
    await expect(card).toHaveCount(0)
    await expect(surface.getByTestId('queue-row-1')).toBeVisible()
  })
})
