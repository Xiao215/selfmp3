import type { RefObject } from 'react'
import type { View } from 'react-native'

const nothing = (): void => {}

/**
 * Dropping the click that ends a swipe with a *pointer*, in the browser's own
 * terms. Hands back what the swipe calls as it moves.
 *
 * Nothing away from the web: on a phone, gesture handler cancels the presses
 * under a pan that has taken over, so a swiped row is never also tapped.
 */
export function useSwallowSwipeClick(_ref: RefObject<View | null>): () => void {
  return nothing
}
