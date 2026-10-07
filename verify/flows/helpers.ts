import { expect, test, type Locator, type Page } from '@playwright/test'

import { appApi } from '../env.js'

/**
 * Selectors, derived from the app's accessible names rather than test ids.
 *
 * Written first against the web app, which these flows could not add hooks to,
 * and kept that way: a selector built on a role and a name survives React
 * Native Web's DOM, where every class name is generated.
 */

/**
 * A song or tag name, safe to drop into a `RegExp`.
 *
 * Library names are data, and real ones are full of regex metacharacters —
 * `Engine Oil (AUTHENTIC CHINESE KISSA "Ai no Pegasus" -SPICY DRAGON OF LOVE -
 * 2024 / LIVE)` matched nothing at all unescaped, and the flow that used it
 * failed as a ten-second timeout that read like a broken app. Two specs had
 * their own copy of this and a third did not; it lives here now.
 */
export function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Open the library, which is `/library` now that the app opens on Home
 * (docs/UI-MIGRATION.md, Phase 2). Every flow that starts with "open Library"
 * goes through here, so where Library lives is written once.
 */
export async function openLibrary(page: Page): Promise<void> {
  await page.goto('/library')
}

/**
 * Play the whole library, shuffled, so Up next has songs after the one
 * playing. A tap on a library row plays that song alone (docs/features/lists.md),
 * so a flow that needs a next song starts here: the head's Shuffle on a
 * computer, the tools' Shuffle on a phone.
 */
export async function shuffleLibrary(page: Page): Promise<void> {
  const phone = page.getByTestId('library-shuffle-phone')
  if (await phone.isVisible().catch(() => false)) await phone.click()
  else await page.getByTestId('library-shuffle').click()
}

/** The songs table, which is labelled `<heading> songs`. */
function songTable(page: Page): Locator {
  return page.getByRole('table', { name: /songs$/ })
}

export function songRows(page: Page): Locator {
  return songTable(page).getByRole('row')
}

/**
 * A row's song title, read off the one control that always carries it.
 *
 * `More actions for <title>` is on every row at both widths, where the visible
 * title is a `<span>` with no accessible name of its own.
 */
export async function titleOf(row: Locator): Promise<string> {
  const label = await row
    .getByRole('button', { name: /^More actions for / })
    .getAttribute('aria-label')
  return (label ?? '').replace(/^More actions for /, '')
}

export function rowFor(page: Page, title: string): Locator {
  return songRows(page).filter({
    has: page.getByRole('button', { name: `More actions for ${title}` }),
  })
}

/** The screen the app shows when it could not reach the server at all. */
function unreachable(page: Page): Locator {
  return page.getByRole('heading', { name: /can.t reach your library/i })
}

/**
 * Wait for the library query to have settled, whichever way it went.
 *
 * Three outcomes, and telling them apart is the point: songs, an empty
 * library, or no server. Without the third, that case lands here as a
 * thirty-second timeout on "the table never appeared", which reads like a
 * broken app and is actually a server nobody started.
 */
export async function libraryReady(page: Page): Promise<void> {
  await expect(
    songTable(page)
      .or(unreachable(page))
      .or(page.getByText(/no songs|nothing here/i)),
  ).toBeVisible({ timeout: 30_000 })

  if (await unreachable(page).isVisible()) {
    // Fail rather than skip: an unreachable server means these flows checked
    // nothing, and a green run would be a lie. Skipping is for a library that
    // is genuinely empty.
    throw new Error(
      'The app could not reach the server. Start the server (`npm run dev`, or `npm start` ' +
        'after `npm run build`) before running these flows. See verify/README.md.',
    )
  }
}

/**
 * Skip rather than fail when the dev library is empty.
 *
 * An empty library is a setup problem — `npm run dev` pointed at a folder with
 * nothing in it — and reading that as a regression would send someone looking
 * for a bug in the app.
 */
export async function skipIfNoLibrary(page: Page, need = 1): Promise<void> {
  const count = await songRows(page).count()
  test.skip(
    count < need,
    `needs at least ${need} song(s) in the dev library; found ${count}. ` + 'See verify/README.md.',
  )
}

/**
 * Start a song the way a person does, at whichever width the test is running.
 *
 * There is no one control for this, which is why it lives here rather than in
 * a spec. With a pointer, at computer width, a row's number turns into a
 * `Play <title>` button only while the pointer is over the row (`revealed` in
 * apps/app's `SongRow.tsx`), so it has to be hovered into existence before it
 * can be clicked. At phone width that button is never drawn, and the row
 * itself is the control.
 */
export async function playSong(page: Page, row: Locator): Promise<void> {
  const title = await titleOf(row)

  // Hover first: on the desktop layout this is what makes the button exist.
  await row.hover()
  const button = row.getByRole('button', { name: `Play ${title}` })
  if (await button.isVisible().catch(() => false)) {
    await button.click()
    return
  }

  // The phone layout, where the row is the control.
  await row.dblclick()
}

/**
 * Where the song has actually got to, in seconds, read off the scrubber.
 *
 * This is the check that the song is *playing* rather than that the UI said it
 * would: a stream URL built wrong still flips the button to Pause, and then
 * nothing ever advances. It cannot be read from an `<audio>` element, because
 * there are none in the document — `engine.web.ts` builds its elements with
 * `new Audio()` and never appends them, so `document.querySelector('audio')`
 * is always null. The scrubber's value is the engine's `currentTime`, and it
 * has the advantage of being the number a person can see.
 *
 * Below the breakpoint the mini player has no scrubber, so the caller opens
 * now playing first; `seekReady` does that.
 */
export async function positionSeconds(page: Page): Promise<number> {
  const seek = page.getByLabel('Seek').first()
  // The scrubber is a custom control announcing itself as a slider, so the
  // position is in `aria-valuenow`; a plain range input carries it in `value`.
  // Neither is more true than the other, so this reads whichever is there.
  const value = await seek.getAttribute('aria-valuenow')
  if (value !== null) return Number(value)
  return Number(await seek.inputValue())
}

/**
 * Make sure a scrubber is on screen, whichever width this is running at.
 *
 * The desktop player bar has one at rest. The phone's mini player does not —
 * the position lives on the now-playing screen, which is one tap away.
 */
export async function seekReady(page: Page): Promise<void> {
  if ((await page.getByLabel('Seek').count()) > 0) return
  await page.getByRole('button', { name: /^Open now playing: / }).click()
  await expect(page.getByLabel('Seek').first()).toBeVisible()
}

/**
 * The transport of whichever surface is in front.
 *
 * Below the breakpoint, opening now playing leaves the mini player's transport
 * in the DOM behind it, so a plain `getByRole('button', { name: 'Pause' })`
 * matches two buttons — and the first is the covered one, which Playwright
 * will refuse to click because the sheet on top of it intercepts the pointer.
 * The surfaces render in stacking order, so the last match is the one a finger
 * would actually reach. At desktop width there is only ever one.
 */
export function transport(page: Page, name: 'Play' | 'Pause'): Locator {
  return page.getByRole('button', { name, exact: true }).last()
}

/**
 * The row at the top of the list — by where it is drawn, not by DOM order.
 *
 * These are not the same thing once the list recycles. A virtualised list
 * keeps its rows in a stable DOM order and moves them by position, so after
 * reversing the sort the first element in the document can still be the song
 * that was at the top while the screen quite correctly shows a different one —
 * and a flow reading `.first()` concludes the sort did nothing.
 *
 * Where the two orders agree this returns exactly what `.first()` would.
 * Anywhere "the first song" means the one a person sees at the top, use this.
 */
export async function topRow(page: Page): Promise<Locator> {
  const rows = songRows(page)
  const count = await rows.count()
  if (count === 0) return rows.first()

  let top = 0
  let smallest = Number.POSITIVE_INFINITY
  for (let index = 0; index < count; index += 1) {
    const box = await rows.nth(index).boundingBox()
    if (box && box.y < smallest) {
      smallest = box.y
      top = index
    }
  }
  return rows.nth(top)
}

/** As much of `/api/library` as the specs that read it directly need. */
export interface LibraryTag {
  id: number
  name: string
}
export interface LibrarySong {
  tagIds: number[]
  missing: boolean
  playCount: number
}

/** The library as the server has it, for a spec that works out what the app should show. */
export async function libraryData(
  page: Page,
): Promise<{ songs: LibrarySong[]; tags: LibraryTag[] }> {
  const response = await page.request.get(`${appApi}/api/library`)
  return (await response.json()) as { songs: LibrarySong[]; tags: LibraryTag[] }
}

/** Skip a flow that reads a link or a name, on a server with no yt-dlp to do it with. */
export async function skipWithoutYtDlp(page: Page): Promise<void> {
  const tools = await page.request
    .get(`${appApi}/api/import/tools`)
    .then(async response =>
      response.ok() ? ((await response.json()) as { ytdlp?: boolean }) : null,
    )
    .catch(() => null)
  test.skip(!tools?.ytdlp, 'the server has no yt-dlp to read links with')
}

/**
 * The resume toast ("Continue … from your other device") floats over the
 * bottom of a phone-sized screen, which is where Import's buttons end up.
 */
export async function dismissToasts(page: Page): Promise<void> {
  for (const button of await page.getByRole('button', { name: 'Dismiss' }).all()) {
    await button.click().catch(() => {})
  }
}
