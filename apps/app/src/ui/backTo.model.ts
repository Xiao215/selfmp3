/**
 * Going back to a page, without the screen: the rule behind every "‹ Profile",
 * "‹ Import" and "Go to the library".
 *
 * Pushing the page again stacked a second copy of it on top of the first, so
 * the system back gesture then went "forward" into the page just left. Going
 * back is right when the page is the one behind this one; when it is not —
 * the address was typed, a link was followed, the app was opened here — back
 * would leave for somewhere unrelated, so the page replaces this one instead.
 */

/** The navigator's view of its stack: only the part this reads. */
export interface StackState {
  readonly index: number
  readonly routes: readonly { readonly name: string }[]
}

/**
 * The route a file-based address is drawn by: `/` is `index`, `/import` is
 * `import/index` or `import`, `/you` is `you`.
 */
export function routeNamesFor(href: string): readonly string[] {
  const path = href.replace(/^\/+|\/+$/g, '')
  return path === '' ? ['index'] : [path, `${path}/index`]
}

/** Whether the screen directly behind this one is the page `href` names. */
export function isBehind(state: StackState | undefined, href: string): boolean {
  if (!state || state.index < 1) return false
  const behind = state.routes[state.index - 1]
  return behind !== undefined && routeNamesFor(href).includes(behind.name)
}
