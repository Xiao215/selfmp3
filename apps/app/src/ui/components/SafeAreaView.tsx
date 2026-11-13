import type { ReactNode } from 'react'
import { View, type ViewProps } from 'react-native'
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context'

const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left']

/**
 * The safe-area view every screen sits in: a plain view padded by the
 * window's insets on the edges asked for.
 *
 * Not the library's own safe-area view, which measures where it is in the
 * window and pads itself afterwards, a frame or more after it is first
 * drawn: a page arriving drew its head under the clock and then dropped it
 * by the status bar's height, and a page caught in the middle of a push
 * measured no status bar at all. Every page fills the window, so the
 * window's insets are its own, and they are known before the first frame.
 * A plain view is also one Unistyles restyles when the theme changes.
 */
export function SafeAreaView({
  edges = ALL_EDGES,
  style,
  children,
  ...rest
}: ViewProps & { edges?: readonly Edge[] }): ReactNode {
  const insets = useSafeAreaInsets()
  const on = (edge: Edge): boolean => edges.includes(edge)
  // Only the edges asked for: a key left undefined would still wipe out a padding of the page's.
  const padding = {
    ...(on('top') ? { paddingTop: insets.top } : null),
    ...(on('right') ? { paddingRight: insets.right } : null),
    ...(on('bottom') ? { paddingBottom: insets.bottom } : null),
    ...(on('left') ? { paddingLeft: insets.left } : null),
  }
  return (
    <View {...rest} style={[style, padding]}>
      {children}
    </View>
  )
}
