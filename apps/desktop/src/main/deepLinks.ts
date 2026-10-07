/**
 * `selfmp3://` URLs, from wherever the operating system put them.
 *
 * macOS hands a URL to a running app through `open-url`, and to a cold one
 * through the same event just after `ready`. Windows and Linux hand it to a
 * *second* process, whose argv the first process is given through
 * `second-instance`, and to a cold one on its own command line. The page does
 * not care which happened, so this collects all four into one stream.
 *
 * Pure, apart from the queue, so the argv-picking is testable: the URL is
 * rarely the first argument and never in the same position twice.
 */

import { DEEP_LINK_SCHEME } from '@selfmp3/desktop-bridge'

export function deepLinkFromArgv(argv: readonly string[]): string | null {
  return argv.find(one => one.startsWith(`${DEEP_LINK_SCHEME}://`)) ?? null
}

export class DeepLinks {
  /** The page that can hear a link now, or null while there is none. */
  #send: ((url: string) => void) | null = null
  /**
   * Links that arrived while no page could hear them.
   *
   * A cold launch from a sign-in return is exactly this case: the URL is on
   * the command line before the window's page has loaded, let alone run the
   * module that listens. Held rather than dropped, or signing in from a
   * closed app would do nothing — `webContents.send` to a page that is still
   * loading goes nowhere.
   */
  readonly #pending: string[] = []

  deliver(url: string | null): void {
    if (url === null) return
    if (this.#send) this.#send(url)
    else this.#pending.push(url)
  }

  /** A page has loaded and listens: hand it what was held, and everything after. */
  ready(send: (url: string) => void): void {
    this.#send = send
    const waiting = this.#pending.splice(0, this.#pending.length)
    for (const url of waiting) send(url)
  }

  /** The page is reloading or gone: hold links again until the next `ready`. */
  unready(): void {
    this.#send = null
  }
}

/** As much of a window's `webContents` as following its page takes. */
export interface LinkPage {
  on(event: 'did-start-loading' | 'did-finish-load' | 'destroyed', listener: () => void): unknown
  send(channel: string, url: string): void
}

/**
 * Deliver links to `page` only while it has a loaded page to hear them.
 *
 * Called for every window the shell makes, so a window made again — after the
 * last one closed, off macOS — takes over the stream. A load starting (the
 * first one, or a reload) holds links until it finishes; `did-finish-load`
 * comes after the export's scripts have run, which is when the page's own
 * listener exists (apps/app's `ports/deepLinks.web.ts` subscribes as its
 * module loads, and keeps what arrives before a screen asks).
 */
export function followPage(links: DeepLinks, page: LinkPage, channel: string): void {
  page.on('did-start-loading', () => links.unready())
  page.on('did-finish-load', () => links.ready(url => page.send(channel, url)))
  page.on('destroyed', () => links.unready())
}
