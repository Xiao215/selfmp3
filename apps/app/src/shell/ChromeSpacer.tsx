import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useBottomInset } from './bottomInset'

/**
 * Room at the end of a phone's scrolling page for the tab bar and the mini
 * player floating over it, so the last row can be scrolled out from under
 * them. Nothing on a computer. The last child of the scroll view, or a list's
 * footer.
 */
export function ChromeSpacer(): ReactNode {
  const height = useBottomInset()
  return height > 0 ? <View style={{ height }} /> : null
}
