import type { ScrollView } from 'react-native'
import type { RefObject } from 'react'

/**
 * Dragging a sideways list along, for a pointer that cannot flick it.
 *
 * Nothing to do on a phone or an iPad: a finger already drags the list, and
 * the browser's twin is what this file exists for.
 */
export function useDragScroll(): { ref?: RefObject<ScrollView | null> } {
  return {}
}
