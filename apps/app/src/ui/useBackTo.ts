import { useNavigation, useRouter, type Href } from 'expo-router'
import { isBehind, type StackState } from './backTo.model'

/**
 * Go to `href` the way a back button should: back, when that page is the one
 * behind this; otherwise in this one's place (`backTo.model.ts`). For a link
 * or a button that returns somewhere — "Go to the library", "Import page" —
 * and for the round ‹ every page opened from another wears (`BackButton`).
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
