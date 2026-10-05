import { useCallback, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'

/**
 * How many pages under the one on top stay drawn.
 *
 * One flat stack holds every page (`app/_layout.tsx`), and going to a page
 * the stack does not have on top adds it: Library → Tags → Stats → Library is
 * four pages, two of them Library. A native stack keeps every one of them
 * mounted — in a browser as a `display: none` copy with its whole list, its
 * covers, its queries and its player subscriptions, all still rendering. Each
 * sidebar click left another one behind; a long session took a tab to 2.4 GB,
 * and it crashed.
 *
 * So only the top few pages keep their content. A page further down stays in
 * the stack, so Back still goes where it went, but draws nothing until it is
 * near the top again. Then it mounts fresh, from the queries' cache.
 *
 * Two, not one: Now Playing on a phone is a see-through modal, so the page
 * under it shows. A swipe back draws the page under that one. Either way,
 * what is on screen during a transition is always drawn.
 */
const PAGES_KEPT_BELOW = 2

/** Whether the route `routeIndex` deep in a stack focused on `focused` is drawn. */
function keptNearTop(routeIndex: number, focused: number): boolean {
  // Not in the state (-1) or above the focused one: on its way in or out.
  return routeIndex < 0 || focused - routeIndex <= PAGES_KEPT_BELOW
}

/** What a screen's navigation offers here: the stack's state, and word when it changes. */
type StackNavigation = {
  getState: () => { index: number; routes: readonly { key: string }[] }
  addListener: (event: 'state', listener: () => void) => () => void
}

function KeepNearTop({
  routeKey,
  navigation,
  children,
}: {
  routeKey: string
  navigation: StackNavigation
  children: ReactNode
}): ReactNode {
  const subscribe = useCallback(
    (onChange: () => void) => navigation.addListener('state', onChange),
    [navigation],
  )
  const kept = useCallback(() => {
    const state = navigation.getState()
    return keptNearTop(
      state.routes.findIndex(route => route.key === routeKey),
      state.index,
    )
  }, [navigation, routeKey])
  const drawn = useSyncExternalStore(subscribe, kept, kept)
  return drawn ? children : null
}

/** The stack's `screenLayout`: every page's content, drawn only near the top. */
export function keepNearTop({
  route,
  navigation,
  children,
}: {
  route: { key: string }
  navigation: unknown
  children: ReactElement
}): ReactElement {
  return (
    <KeepNearTop routeKey={route.key} navigation={navigation as StackNavigation}>
      {children}
    </KeepNearTop>
  )
}
