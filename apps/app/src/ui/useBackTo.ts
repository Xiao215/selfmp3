import { useNavigation, useRouter } from 'expo-router'
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
