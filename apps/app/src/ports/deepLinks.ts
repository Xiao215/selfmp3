/**
 * `selfmp3://` links the operating system handed the app.
 *
 * A phone has its own deep-link handling through Expo Router's linking, and a
 * browser has an address bar, so this is the desktop's: the shell claims the
 * scheme, and links arrive over the bridge. Nothing here on the other
 * platforms — a phone's sign-in returns are read in `ports/signInReturn`.
 */

/** Where a link asks the app to go. Sign-in returns are not one of these. */
export type DeepLinkRoute =
  { readonly kind: 'now-playing' } | { readonly kind: 'playlist'; readonly id: string }

/**
 * Each `selfmp3://…#signin-code=…` link, whole, for `ports/signInReturn` to sort
 * by where it was sent. Links that arrived before anything was listening are
 * kept, because a cold launch from a sign-in always is.
 */
export function onSignInLink(_listener: (url: string) => void): () => void {
  return () => {}
}

/** Somewhere to go, with any link that arrived before this was called. */
export function onDeepLinkRoute(_listener: (route: DeepLinkRoute) => void): () => void {
  return () => {}
}
