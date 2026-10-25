/**
 * The pages a browser's Back and Forward come back to, as the live ones.
 *
 * A step through a browser's history hands the navigator the whole state that
 * history entry was saved with (expo-router's `useLinking`, `resetRoot`). The
 * first entry, the address the tab was opened at, was saved before anything
 * was mounted, with no keys at all, and a navigator given a route under a key
 * it has never seen mounts it anew. The route at the root of every state is
 * the app's own layout, so Back to the first page remounted the whole app:
 * every provider, the player's engine with them, and the music stopped
 * (bug bash F096). Every later entry then named keys from before, and Forward
 * was refused ("RESET … was not handled by any navigator") and left the page
 * where it was (F066).
 *
 * So the state an entry restores is put on the live state's keys first:
 * each navigator keeps its key, and each route that is still there — the
 * same page with the same params — keeps its own, so it stays mounted. What
 * is not there any more is left as the entry had it, and drawn fresh.
 */

interface Route {
  readonly key?: string
  readonly name: string
  readonly params?: object
  readonly state?: NavState
}

export interface NavState {
  readonly key?: string
  readonly index?: number
  readonly routes: readonly Route[]
}

/**
 * `incoming`, on the keys `live` has for the same navigators and routes.
 *
 * An entry the router has no saved state for is read from its address alone:
 * a navigator with no key and the one page the address names (Forward to a
 * page whose entry was saved before the app last drew, F073's See all). That
 * page is taken as a step from the live stack rather than the whole of it:
 * back to it where the stack has it, and on top of the stack where it does not.
 */
export function onLiveKeys(given: NavState, live: NavState | undefined): NavState {
  if (!live) return given
  const incoming = given.key === undefined ? stepFromLive(given, live) : given
  const taken = new Set<string>()
  const routes = incoming.routes.map((route, index) => {
    const match = liveTwin(route, index, live.routes, taken)
    if (!match?.key) return route
    taken.add(match.key)
    return {
      ...route,
      key: match.key,
      ...(route.state ? { state: onLiveKeys(route.state, match.state) } : null),
    }
  })
  return { ...incoming, ...(live.key ? { key: live.key } : null), routes }
}

/** The one page an address names, as a step back or on from the live stack. */
function stepFromLive(incoming: NavState, live: NavState): NavState {
  const [only] = incoming.routes
  if (incoming.routes.length !== 1 || !only || live.routes.length === 0) return incoming
  const at = live.routes.findIndex(
    each => each.name === only.name && sameParams(each.params, only.params),
  )
  const routes = at >= 0 ? [...live.routes.slice(0, at), only] : [...live.routes, only]
  return { ...incoming, routes, index: routes.length - 1 }
}

/** The live route that is the same page: its name and params, the one in the same place first. */
function liveTwin(
  route: Route,
  index: number,
  live: readonly Route[],
  taken: ReadonlySet<string>,
): Route | undefined {
  const same = (each: Route | undefined): each is Route =>
    each !== undefined &&
    each.key !== undefined &&
    !taken.has(each.key) &&
    each.name === route.name &&
    sameParams(each.params, route.params)
  const there = live[index]
  return same(there) ? there : live.find(same)
}

function sameParams(a: object | undefined, b: object | undefined): boolean {
  return JSON.stringify(sorted(a ?? {})) === JSON.stringify(sorted(b ?? {}))
}

/** A value with its keys in order, so two params objects compare by what they hold. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, each]) => each !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, each]) => [key, sorted(each)]),
  )
}
