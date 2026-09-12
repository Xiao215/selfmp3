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
    songTable(page).or(unreachable(page)).or(page.getByText(/no songs|nothing here/i)),
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
    `needs at least ${need} song(s) in the dev library; found ${count}. ` +
      'See verify/README.md.',
  )
}
