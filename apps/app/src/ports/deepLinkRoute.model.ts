/**
 * What a `selfmp3://` link asks the app to do, and how to read one.
 *
 * Beside the `deepLinks` port rather than inside one of its twins: the parser
 * is the same on every platform — only *whether* links arrive differs, which
 * is the port's business — and here it is a model the tests reach directly
 * and the twins' shapes match.
 */

/** Where a link asks the app to go. Sign-in returns are not one of these. */
export type DeepLinkRoute =
  { readonly kind: 'now-playing' } | { readonly kind: 'playlist'; readonly id: string }

/** `selfmp3://playlist/12` → the playlist; `selfmp3://now-playing` → the stage. */
export function routeFor(url: string): DeepLinkRoute | null {
  const match = /^selfmp3:\/\/([A-Za-z-]+)(?:\/([^?#]*))?/.exec(url)
  if (!match) return null
  const [, host, rest] = match
  if (host === 'now-playing') return { kind: 'now-playing' }
  if (host === 'playlist') {
    const id = decodeURIComponent(rest ?? '').replace(/\/$/, '')
    // A playlist id is a number in this app. Anything else is a link from
    // somewhere that guessed, and going nowhere is better than a broken screen.
    return /^\d+$/.test(id) ? { kind: 'playlist', id } : null
  }
  return null
}
