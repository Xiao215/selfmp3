import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { libraryReady, playSong, rowFor, songRows, titleOf } from './flows/helpers.js'
import { SEEDED, seedReferenceLibrary } from './reference/seed.js'

/**
 * The reference set: the old web app, at 1280 and 375, before it is deleted.
 *
 * `docs/UNIVERSAL.md` — *The reference set* — asks for this to be captured once
 * and committed, because phase 5 deletes `apps/web` and these images are what
 * outlives it. Every screen of the new app is checked against them, and phase 4
 * cannot begin without them.
 *
 * It is a script rather than a one-off session so that it is reproducible: the
 * states are fixed, the library it captures is seeded by `reference/seed.ts`,
 * and the same song plays in every state that has one playing.
 *
 * Output: `docs/reference/<short-sha>/<width>/<state>.png`, the sha being the
 * commit that still has the old app in it.
 */

const SHA =
  process.env.SELFMP3_REFERENCE_SHA ?? execSync('git rev-parse --short HEAD').toString().trim()

/** The one song that plays in every state that has one, so the set is coherent. */
const SONG = 'アイドル'

/**
 * The accent every capture is taken at.
 *
 * "Capture with … the same accent" is one of the plan's conditions, and it is
 * easy to break without noticing: the accent is a *server* setting, so the
 * capture that demonstrates changing it leaves the library on a different
 * colour, and the second width then gets captured on that instead. Pinning it
 * for the run and putting it back afterwards is what keeps 1280 and 375
 * comparable — they are supposed to differ by layout and nothing else.
 *
 * 330 because that is what the dev library is actually set to. The token test
 * in the plan resolves its colours at 268; that is a different question, and
 * the reference set is the app as it really looks.
 */
const ACCENT = 330

/** A visibly different hue, only for the "accent changed" capture. */
const ACCENT_CHANGED = 30

const API = process.env.SELFMP3_API_URL ?? 'http://localhost:4600'

async function setAccent(hue: number): Promise<void> {
  await fetch(`${API}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accentHue: hue }),
  })
}

interface PlaylistRow {
  id: number
  name: string
}

/** The playlists the library currently holds, typed rather than `any`. */
async function playlistsOf(request: APIRequestContext): Promise<PlaylistRow[]> {
  const response = await request.get(`${API}/api/library`)
  const body = (await response.json()) as { playlists: PlaylistRow[] }
  return body.playlists
}

async function readSettings(): Promise<{ accentHue: number; theme: string }> {
  return (await (await fetch(`${API}/api/settings`)).json()) as { accentHue: number; theme: string }
}

/**
 * Where the images go. The reference set by default; `SELFMP3_CAPTURE_DIR`
 * sends them elsewhere, which is how the new app is photographed in the same
 * states without touching the committed set (phase 4 uses `verify/captures`).
 */
function outDir(project: string): string {
  const captures = process.env.SELFMP3_CAPTURE_DIR
  if (captures) return path.join(path.resolve(captures), project)
  return path.join(process.cwd(), 'docs', 'reference', SHA, project)
}

async function shot(page: Page, project: string, name: string): Promise<void> {
  const dir = outDir(project)
  fs.mkdirSync(dir, { recursive: true })
  // The viewport, not the full page: the reference is what the layout does at
  // a width, and a full-page capture of a scrolling list is not comparable.
  await page.screenshot({ path: path.join(dir, `${name}.png`) })
}

/**
 * The resume toast ("Continue … from your other device") appears on its own
 * schedule and would land in half the captures. It is dismissed everywhere and
 * captured deliberately in `devices-resume-toast`.
 */
async function dismissToasts(page: Page): Promise<void> {
  for (const button of await page.getByRole('button', { name: 'Dismiss' }).all()) {
    await button.click().catch(() => {})
  }
}

async function home(page: Page): Promise<void> {
  await page.goto('/')
  await libraryReady(page)
  await dismissToasts(page)
  await restMouse(page)
  // The covers fade in; a capture taken mid-fade differs run to run.
  await page.waitForTimeout(600)
}

/**
 * Put the pointer somewhere that reveals nothing.
 *
 * Rows show their controls on hover, and dismissing the resume toast leaves
 * the pointer exactly over the bottom row — so "at rest" came out with that
 * row hovered. The header is the one strip that reacts to nothing.
 */
async function restMouse(page: Page): Promise<void> {
  const size = page.viewportSize()
  await page.mouse.move(Math.round((size?.width ?? 400) / 2), 4)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

/**
 * Scroll whatever is actually scrolling.
 *
 * The app scrolls an inner container rather than the window, so
 * `window.scrollTo` did nothing and the top and bottom captures of Settings
 * came out as the same image.
 */
async function scrollTo(page: Page, where: 'top' | 'bottom'): Promise<void> {
  await page.evaluate(edge => {
    const scrollable = Array.from(document.querySelectorAll('*')).filter(element => {
      const style = getComputedStyle(element)
      return element.scrollHeight > element.clientHeight + 40 && /auto|scroll/.test(style.overflowY)
    })
    const target = scrollable[scrollable.length - 1] ?? document.scrollingElement
    if (target) target.scrollTop = edge === 'bottom' ? target.scrollHeight : 0
  }, where)
}

/** Settle animations before a capture, so two runs produce the same image. */
async function settle(page: Page, ms = 500): Promise<void> {
  await page.waitForTimeout(ms)
}

function moreButton(page: Page, title: string): Locator {
  return rowFor(page, title).getByRole('button', { name: `More actions for ${title}` })
}

test.describe.configure({ mode: 'serial' })

/** What the library looked like before the run, so it can be put back. */
let restore: { accentHue: number; theme: string } | null = null

test.beforeAll(async () => {
  await seedReferenceLibrary()
  restore ??= await readSettings()
  await setAccent(ACCENT)
})

test.afterAll(async () => {
  if (restore) await setAccent(restore.accentHue)
})

test.describe('reference', () => {
  test('library', async ({ page }, info) => {
    const project = info.project.name
    await home(page)
    await shot(page, project, 'library-rest')

    // A search typed.
    await page.getByLabel('Search library').fill('ハル')
    await settle(page)
    await shot(page, project, 'library-search')
    await page.getByLabel('Clear search').click()
    await settle(page)

    // One tag filtered, one excluded. The two widths reach "excluded" by
    // different routes, which is itself part of what the new app has to match:
    // the sidebar has a dedicated hide button per tag, while the phone's chip
    // strip hides the same control behind a long press on the chip.
    await page.getByRole('button', { name: 'yoasobi', exact: true }).first().click()
    await settle(page, 250)
    if (project === 'phone') {
      const chip = page.getByRole('button', { name: SEEDED.tag, exact: true }).first()
      const box = await chip.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        // Longer than CHIP_HOLD_MS (450ms), which is what opens the editor.
        await page.waitForTimeout(700)
        await page.mouse.up()
        await settle(page, 400)
        await page.getByRole('button', { name: /Hide these/ }).click()
      }
    } else {
      const hide = page.getByRole('button', { name: `Hide songs tagged ${SEEDED.tag}` }).first()
      await hide.scrollIntoViewIfNeeded().catch(() => {})
      await hide.click()
    }
    await settle(page)
    await restMouse(page)
    await shot(page, project, 'library-tags-filtered-excluded')
    await home(page)

    // The sort control, open.
    await page.getByRole('combobox', { name: 'Sort by' }).click()
    await settle(page)
    await shot(page, project, 'library-sort-open')
    await page.keyboard.press('Escape')
    await settle(page, 250)

    // Selection mode with two rows chosen.
    await page.getByRole('button', { name: 'Select' }).click()
    await settle(page, 250)
    const rows = songRows(page)
    for (const row of [rows.nth(0), rows.nth(1)]) {
      const title = await titleOf(row)
      await row.getByRole('checkbox', { name: `Select ${title}` }).click()
    }
    await settle(page)
    await shot(page, project, 'library-selection-two')
    await home(page)

    // A row's ⋯ menu.
    const first = await titleOf(songRows(page).first())
    await rowFor(page, first).hover()
    await moreButton(page, first).click()
    await settle(page)
    await shot(page, project, 'library-row-menu')
    await page.keyboard.press('Escape')
    await settle(page, 250)

    // A song playing: the row tint, the equaliser, the bar.
    await playSong(page, rowFor(page, SONG))
    await expect(page.getByRole('button', { name: 'Pause' }).last()).toBeVisible()
    await settle(page, 1200)
    await shot(page, project, 'library-playing')
  })

  test('playlists', async ({ page }, info) => {
    const project = info.project.name

    // The empty state needs a library with no playlists in it. Only the three
    // this script seeded are removed, never anything else, and they are put
    // straight back — so on a library with playlists of its own the capture is
    // honestly not empty, and says so by being what it is.
    const seeded = Object.values(SEEDED) as string[]
    const mine = (await playlistsOf(page.request)).filter(p => seeded.includes(p.name))
    for (const playlist of mine) await page.request.delete(`${API}/api/playlists/${playlist.id}`)

    await page.goto('/playlists')
    await dismissToasts(page)
    await settle(page, 800)
    await shot(page, project, 'playlists-empty')

    await seedReferenceLibrary()
    await page.goto('/playlists')
    await dismissToasts(page)
    await settle(page, 800)
    await shot(page, project, 'playlists-list')

    // Open each by id rather than by clicking its card: the cards carry their
    // title as plain text inside an unnamed control, and a route is what the
    // new app will have too.
    const ids = new Map((await playlistsOf(page.request)).map(p => [p.name, p.id]))

    for (const [name, capture, openRules] of [
      [SEEDED.manual, 'playlist-manual', false],
      [SEEDED.smart, 'playlist-smart-rules', true],
      [SEEDED.empty, 'playlist-empty', false],
    ] as const) {
      const id = ids.get(name)
      expect(id, `seeded playlist "${name}" should exist`).toBeTruthy()
      await page.goto(`/playlists/${String(id)}`)
      await dismissToasts(page)
      await settle(page, 900)
      if (openRules) {
        await page.getByRole('button', { name: 'Edit rules' }).first().click()
        await settle(page, 800)
      }
      await shot(page, project, capture)
    }
  })

  test('now playing', async ({ page }, info) => {
    const project = info.project.name
    await home(page)

    // Nothing playing, before anything starts.
    await page
      .getByRole('button', { name: /^Open now playing: / })
      .click()
      .catch(() => {})
    await settle(page, 600)
    await shot(page, project, 'nowplaying-nothing')
    await page.keyboard.press('Escape')
    await settle(page, 300)

    await home(page)
    await playSong(page, rowFor(page, SONG))
    await expect(page.getByRole('button', { name: 'Pause' }).last()).toBeVisible()
    await settle(page, 1200)

    await page.getByRole('button', { name: /^Open now playing: / }).click()
    await settle(page, 900)
    await shot(page, project, project === 'phone' ? 'nowplaying-art' : 'nowplaying-stage')

    // The lyrics, with a line active.
    const showLyrics = page.getByRole('button', { name: 'Show the lyrics' })
    if (await showLyrics.isVisible().catch(() => false)) {
      await showLyrics.click()
    } else {
      await page
        .getByRole('tab', { name: /Lyrics|Visual/ })
        .click()
        .catch(() => {})
    }
    await settle(page, 1500)

    // The two lyric captures are "off" and "on", in that order, whichever way
    // the library happens to be set — `lyricsRomanization` is a stored setting
    // and this dev library has it on, so taking them as they came would have
    // produced two identical images labelled differently.
    const romaji = page.getByRole('button', { name: /Romaji|Pinyin/ }).first()
    const romajiOn = async (): Promise<boolean> =>
      (await romaji.getAttribute('aria-pressed')) === 'true'

    if (await romaji.isVisible().catch(() => false)) {
      if (await romajiOn()) {
        await romaji.click()
        await settle(page, 1200)
      }
      await restMouse(page)
      await shot(page, project, 'nowplaying-lyrics')

      await romaji.click()
      await settle(page, 1500)
      await restMouse(page)
      await shot(page, project, 'nowplaying-romaji')
    } else {
      await shot(page, project, 'nowplaying-lyrics')
    }

    // Up next, and About.
    const queueTab = page.getByRole('tab', { name: 'Up next' })
    if (await queueTab.isVisible().catch(() => false)) {
      await queueTab.click()
      await settle(page, 800)
      await shot(page, project, 'nowplaying-queue')
      await page.getByRole('tab', { name: 'About' }).click()
      await settle(page, 800)
      await shot(page, project, 'nowplaying-about')
      await page.getByRole('tab', { name: /Lyrics|Visual/ }).click()
      await settle(page, 500)
    }

    // Focus, which is desktop only.
    const focus = page.getByRole('button', { name: 'Show only the words' })
    if (await focus.isVisible().catch(() => false)) {
      await focus.click()
      await settle(page, 1000)
      await shot(page, project, 'nowplaying-focus')
    }
  })

  test('player bar', async ({ page }, info) => {
    const project = info.project.name
    await home(page)
    await playSong(page, rowFor(page, SONG))
    await expect(page.getByRole('button', { name: 'Pause' }).last()).toBeVisible()
    await settle(page, 1500)
    await shot(page, project, 'player-playing')

    await page.getByRole('button', { name: 'Pause' }).last().click()
    await settle(page, 600)
    await shot(page, project, 'player-paused')

    // Progress at roughly 40%, set on the scrubber rather than waited for.
    // Below the breakpoint the mini player has no scrubber; it is on the
    // now-playing screen, one tap away.
    if ((await page.getByLabel('Seek').count()) === 0) {
      await page.getByRole('button', { name: /^Open now playing: / }).click()
      await settle(page, 800)
    }
    const seek = page.getByLabel('Seek').first()
    if (await seek.isVisible().catch(() => false)) {
      const max = Number((await seek.getAttribute('max')) ?? '0')
      if (max > 0) {
        await seek.fill(String(Math.round(max * 0.4)))
        await seek.dispatchEvent('pointerup')
        await settle(page, 900)
        await shot(page, project, 'player-progress-40')
      }
    }
  })

  test('sheets and popovers', async ({ page }, info) => {
    const project = info.project.name
    await home(page)
    await playSong(page, rowFor(page, SONG))
    await expect(page.getByRole('button', { name: 'Pause' }).last()).toBeVisible()
    await settle(page, 1000)

    // The two widths keep these in different places: the desktop player bar
    // carries them in its own row, while the phone puts them on a toolbar
    // along the bottom of the now-playing screen.
    if (project === 'phone') {
      await page.getByRole('button', { name: /^Open now playing: / }).click()
      await settle(page, 900)

      for (const [label, name] of [
        ['Queue', 'nowplaying-queue'],
        ['Sleep', 'sheet-sleep-timer'],
        ['Practice', 'sheet-practice'],
        ['Devices', 'devices-popover'],
      ] as const) {
        const button = page.getByRole('button', { name: label, exact: true }).last()
        if (!(await button.isVisible().catch(() => false))) continue
        await button.click()
        await settle(page, 800)
        await restMouse(page)
        await shot(page, project, name)
        await page.keyboard.press('Escape')
        await settle(page, 400)
      }
      return
    }

    for (const [label, name] of [
      ['Sleep timer', 'sheet-sleep-timer'],
      ['Devices', 'devices-popover'],
    ] as const) {
      const button = page.getByRole('button', { name: label }).first()
      if (!(await button.isVisible().catch(() => false))) continue
      await button.click()
      await settle(page, 700)
      await shot(page, project, name)
      await page.keyboard.press('Escape')
      await settle(page, 300)
    }

    const speed = page.getByRole('button', { name: /^Playback speed: / }).first()
    if (await speed.isVisible().catch(() => false)) {
      await speed.click()
      await settle(page, 700)
      await shot(page, project, 'sheet-speed')
      await page.keyboard.press('Escape')
      await settle(page, 300)
    }

    const volume = page.getByRole('button', { name: /^Volume: / }).first()
    if (await volume.isVisible().catch(() => false)) {
      await volume.click()
      await settle(page, 700)
      await shot(page, project, 'sheet-volume-compact')
      await page.keyboard.press('Escape')
      await settle(page, 300)
    }
  })

  test('devices', async ({ page }, info) => {
    const project = info.project.name
    // The resume toast is offered on load when another device has somewhere to
    // carry on from, which is why every other capture dismisses it.
    await page.goto('/')
    await libraryReady(page)
    const toast = page.getByRole('button', { name: 'Dismiss' }).first()
    if (await toast.isVisible({ timeout: 8000 }).catch(() => false)) {
      await restMouse(page)
      await settle(page, 600)
      await shot(page, project, 'devices-resume-toast')
    }
  })

  test('settings', async ({ page }, info) => {
    const project = info.project.name
    await page.goto('/settings')
    await dismissToasts(page)
    await settle(page, 900)
    await shot(page, project, 'settings-top')

    await scrollTo(page, 'bottom')
    await settle(page, 900)
    await shot(page, project, 'settings-bottom')

    await scrollTo(page, 'top')
    await settle(page, 400)

    // The accent, changed — then put straight back, because it is a server
    // setting and would otherwise recolour every capture taken after it.
    const hue = page.getByLabel('Accent hue')
    if (await hue.isVisible().catch(() => false)) {
      await hue.fill(String(ACCENT_CHANGED))
      await hue.dispatchEvent('change')
      await settle(page, 800)
      await restMouse(page)
      await shot(page, project, 'settings-accent')
      await hue.fill(String(ACCENT))
      await hue.dispatchEvent('change')
      await settle(page, 500)
    }

    // The light theme, chosen from the Theme select in Appearance.
    const theme = page.getByRole('combobox', { name: 'Theme' })
    await theme.scrollIntoViewIfNeeded()
    await theme.click()
    await page.getByRole('option', { name: 'Light' }).click()
    await settle(page, 900)
    await restMouse(page)
    await shot(page, project, 'settings-light')

    await theme.click()
    await page.getByRole('option', { name: 'Dark' }).click()
    await settle(page, 500)
  })
})
