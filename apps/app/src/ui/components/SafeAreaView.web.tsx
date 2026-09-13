import type { ComponentProps, ReactNode } from 'react'
import { View, type ViewProps } from 'react-native'
import type { SafeAreaView as PlainSafeAreaView } from 'react-native-safe-area-context'

/**
 * In a browser the safe-area view is a plain `View`.
 *
 * Unistyles puts a themed style on the page as a CSS class, and only the views
 * its Babel plugin rewrites carry that class. The library's own safe-area view
 * is not one of them, so on the web it silently dropped its `flex: 1`: every
 * screen grew to the height of its content, slid under the phone-width tab bar,
 * and could not be scrolled to its end.
 *
 * Nor the phone's `withUnistyles` wrapper: it styles its component's child
 * (`.hash > *`), and Unistyles names a style by its content, so the shell's
 * root, which has the same style, stretched the bottom tabs over half the
 * screen. A browser's safe-area insets are all but always zero, so `edges` has
 * nothing to do here.
 */
export function SafeAreaView({
  edges: _edges,
  mode: _mode,
  children,
  ...rest
}: ViewProps & Pick<ComponentProps<typeof PlainSafeAreaView>, 'edges' | 'mode'>): ReactNode {
  return <View {...rest}>{children}</View>
}
