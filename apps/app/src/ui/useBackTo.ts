import { useNavigation, useRouter, type Href } from 'expo-router'
import { useLayout } from '../shell/useLayout'
import { useOpenedFromSidebar } from '../shell/sidebarEntry'
import { isBehind, type StackState } from './backTo.model'

/**
 * Go to `href` the way a link that returns somewhere should — "Go to the
 * library", "Import page": back, when that page is the one behind this;
 * otherwise in this one's place (`backTo.model.ts`). A page's own ‹ is
 * `usePageBack`, which goes back to wherever you came from.
 */
export function useBackTo(): (href: string) => void {
  const router = useRouter()
  const navigation = useNavigation()
  return href => {
    const state = navigation.getState() as StackState | undefined
    if (isBehind(state, href) && router.canGoBack()) router.back()
    else router.replace(href as never)
  }
}

type Router = ReturnType<typeof useRouter>

/**
 * Back, where there is a page to go back to; `fallback` in this one's place
 * where there is none — the page was the first one there is (a refresh, a
 * copied link), and going back regardless does nothing at all. For the places
 * that hold a router already: an effect, a `leaveStage` callback.
 */
export function goBack(router: Router, fallback: Href): void {
  if (router.canGoBack()) router.back()
  else router.replace(fallback)
}

/** `goBack` as a page's close or ‹ button. */
export function useGoBack(fallback: Href): () => void {
  const router = useRouter()
  return () => goBack(router, fallback)
}

/**
 * A page's ‹ (J1): back to the page you were just on whenever there is one,
 * and `fallback` only when there is nothing behind — a link from outside, a
 * reload. On a phone it is always there. On a computer the sidebar is always
 * there instead, so a page the sidebar opened wears none, and neither does a
 * page with nothing behind it; a page opened from inside another does.
 */
export function usePageBack(fallback: Href): {
  readonly shown: boolean
  readonly back: () => void
} {
  const router = useRouter()
  const { wide } = useLayout()
  const fromSidebar = useOpenedFromSidebar()
  return {
    shown: !wide || (!fromSidebar && router.canGoBack()),
    back: () => goBack(router, fallback),
  }
}
