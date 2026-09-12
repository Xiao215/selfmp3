import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Selectors, derived from the app's accessible names rather than test ids.
 *
 * Deliberate: `apps/web` is read-only reference until phase 5, so these flows
 * cannot add hooks to it. It turns out not to be a compromise — every row
 * carries the song's name in a real `aria-label` already, and a selector built
 * on a role and a name is the one kind that will still work when these same
 * flows are pointed at `apps/app`, where the DOM is React Native Web's and
 * every class name is different.
 */

/**
 * Which app these flows are pointed at.
 *
 * They are written once and run against both: the old web app, where they are
 * phase 1's gate, and `apps/app`, where they are phase 2's. A few things are
 * genuinely not there yet in the new app — not broken, not yet built — and a
 * flow that cannot tell the difference between "missing" and "wrong" is worth
 * less than one that says which. `SELFMP3_APP_API` is set only when pointing
 * them at `apps/app`, because that is the app that has to be told where its Mac
 * is (see verify/playwright.config.ts).
 */
export const againstUniversalApp = Boolean(process.env.SELFMP3_APP_API)

/** The songs table, which is labelled `<heading> songs`. */
export function songTable(page: Page): Locator {
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
export function unreachable(page: Page): Locator {
  return page.getByRole('heading', { name: /can.t reach your library/i })
}

/**
 * Wait for the library query to have settled, whichever way it went.
 *
 * Three outcomes, and telling them apart is the point: songs, an empty
 * library, or no server. The third one used to land here as a thirty-second
 * timeout on "the table never appeared", which reads like a broken app and is
 * actually a server nobody started.
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
      'The app could not reach the server. Start it with `npm run dev` (server on ' +
        '4600, web on 4601) before running these flows. See verify/README.md.',
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
 * a spec. Above the 820 breakpoint the row reveals a play button on hover
 * (`.song-index-play` is `display: none` until `.song-row:hover`), so it has
 * to be hovered into existence before it can be clicked. Below 820 the index
 * column is not rendered at all — `showIndex={!isMobile}` — so that button is
 * not hidden, it is absent, and the row itself is the control: a finger taps
 * once, a mouse double-clicks (`onDoubleClick={play}` on the row).
 *
 * Both paths call the same `play()`. Keeping the choice in one helper is also
 * what makes phase 2 cheap: when these flows are pointed at `apps/app`, this
 * is the single place that knows how a row is started.
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
 * there are none in the document — `engine.ts` builds its two with
 * `new Audio()` and never appends them, so `document.querySelector('audio')`
 * is always null. The scrubber's value is the engine's `currentTime`, and it
 * has the advantage of being the number a person can see.
 *
 * Below the breakpoint the mini player has no scrubber, so the caller opens
 * now playing first; `seekReady` does that.
 */
export async function positionSeconds(page: Page): Promise<number> {
  return Number(await page.getByLabel('Seek').first().inputValue())
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
