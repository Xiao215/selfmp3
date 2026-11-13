import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Animated, StyleSheet } from 'react-native'
import { HiddenPage } from '../ports/hiddenPage'
import { ease, timing } from '../ui/motion'
import { MOVE_MS } from '../ui/motion.model'
import { addressOf } from './backGesture'
import { PAGE_STEP_PHONE, takeTabArrival } from './pageStep'

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
 *
 * In a browser the ones kept but not on screen are hidden from React as well
 * (`ports/hiddenPage`), so a resize or a song change does not draw them.
 */
const PAGES_KEPT_BELOW = 2

/** Whether the route `routeIndex` deep in a stack focused on `focused` is drawn. */
function keptNearTop(routeIndex: number, focused: number): boolean {
  // Not in the state (-1) or above the focused one: on its way in or out.
  return routeIndex < 0 || focused - routeIndex <= PAGES_KEPT_BELOW
}

/** The page a phone's Now Playing is laid over, which shows through it. */
const SEE_THROUGH = 'now-playing'

/**
 * Whether the route is on screen: the focused one, one on its way in or out,
 * or one with only Now Playing above it. A page further down is kept but
 * hidden (`ports/hiddenPage`).
 */
function onScreen(
  routes: readonly { name: string }[],
  routeIndex: number,
  focused: number,
): boolean {
  if (routeIndex < 0 || routeIndex >= focused) return true
  return routes.slice(routeIndex + 1, focused + 1).every(route => route.name === SEE_THROUGH)
}

/** What a screen's navigation offers here: the stack's state, and word when it changes. */
type StackNavigation = {
  getState: () => { index: number; routes: readonly { key: string; name: string }[] }
  addListener: (event: 'state', listener: () => void) => () => void
}

/** Drawn, and on screen too; one string, so the store's answer compares by `===`. */
type Kept = 'gone' | 'hidden' | 'shown'

function KeepNearTop({
  routeKey,
  routeName,
  navigation,
  children,
}: {
  routeKey: string
  routeName: string
  navigation: StackNavigation
  children: ReactNode
}): ReactNode {
  // A tab's page brought by its tab pressed steps in itself, from its first
  // frame (`pageStep.ts`). Asked once, as it mounts: the same page later is
  // not arriving.
  const [side] = useState(() => takeTabArrival(addressOf(routeName)))
  const step = useMemo(() => {
    if (side === null) return null
    const value = new Animated.Value(0)
    const offset = value.interpolate({
      inputRange: [0, 1],
      outputRange: [PAGE_STEP_PHONE * side, 0],
    })
    return { value, style: { opacity: value, transform: [{ translateX: offset }] } }
  }, [side])
  useLayoutEffect(() => {
    if (step !== null) timing(step.value, 1, MOVE_MS.tab, undefined, { easing: ease.out })
  }, [step])
  const subscribe = useCallback(
    (onChange: () => void) => navigation.addListener('state', onChange),
    [navigation],
  )
  const kept = useCallback((): Kept => {
    const state = navigation.getState()
    const index = state.routes.findIndex(route => route.key === routeKey)
    if (!keptNearTop(index, state.index)) return 'gone'
    return onScreen(state.routes, index, state.index) ? 'shown' : 'hidden'
  }, [navigation, routeKey])
  const drawn = useSyncExternalStore(subscribe, kept, kept)
  if (drawn === 'gone') return null
  return (
    <HiddenPage hidden={drawn === 'hidden'}>
      {/* Wrapped only when it steps, which a page knows from its first render to its last. */}
      {step === null ? (
        children
      ) : (
        <Animated.View style={[styles.page, step.style]}>{children}</Animated.View>
      )}
    </HiddenPage>
  )
}

/** The stack's `screenLayout`: every page's content, drawn only near the top. */
export function keepNearTop({
  route,
  navigation,
  children,
}: {
  route: { key: string; name: string }
  navigation: unknown
  children: ReactElement
}): ReactElement {
  return (
    <KeepNearTop
      routeKey={route.key}
      routeName={route.name}
      navigation={navigation as StackNavigation}
    >
      {children}
    </KeepNearTop>
  )
}

const styles = StyleSheet.create({ page: { flex: 1 } })
