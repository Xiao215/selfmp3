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

export function deepLinkFromArgv(argv: readonly string[]): string | null {
  return argv.find(one => one.startsWith('selfmp3://')) ?? null
}

export class DeepLinks {
  #listener: ((url: string) => void) | null = null
  /**
   * Links that arrived before the page was listening.
   *
   * A cold launch from a sign-in return is exactly this case: the URL is on
   * the command line before there is a window, let alone a React effect. Held
   * rather than dropped, or signing in from a closed app would do nothing.
   */
  readonly #pending: string[] = []

  deliver(url: string | null): void {
    if (url === null) return
    if (this.#listener) this.#listener(url)
    else this.#pending.push(url)
  }

  listen(listener: (url: string) => void): void {
    this.#listener = listener
    const waiting = this.#pending.splice(0, this.#pending.length)
    for (const url of waiting) listener(url)
  }

  forget(): void {
    this.#listener = null
  }
}
