/**
 * Where a playlist's page goes back to, with nothing drawn. (Moving its rows
 * is `OrderedSongList`'s: ui/components/orderedSongList.model.ts.)
 */

/**
 * Whether the page just behind this one in the stack is `route` — the
 * navigator's name for it, such as `playlists/index` or `index`.
 *
 * A back link names where it goes ("‹ Playlists", "Back to the library"), and
 * `router.back()` goes wherever the stack says instead: to the library after a
 * playlist made from a selection there, or out of the app after a deep link.
 * Where this is false the link replaces the page with the one it names, so it
 * says what it does and no page is stacked twice.
 */
export function cameFrom(
  state:
    { readonly index: number; readonly routes: readonly { readonly name: string }[] } | undefined,
  route: string,
): boolean {
  if (!state || state.index < 1) return false
  return state.routes[state.index - 1]?.name === route
}
