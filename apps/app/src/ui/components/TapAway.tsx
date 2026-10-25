import type { ReactNode } from 'react'
import { Pressable } from 'react-native'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'

/**
 * A ground that answers a tap without being a control: tapping the page
 * around an open import row closes it, and the open row's own card keeps a
 * tap on it from reaching that ground. It has no look, no role and is not in
 * the accessibility tree — what it closes has its own way to close for a
 * screen reader — so it is the one place a bare Pressable is right, and
 * `Press`, which always answers a press with a look, is not.
 */
export function TapAway({
  onPress,
  style,
  children,
  onLayout,
  testID,
}: {
  /** What a tap does; absent while there is nothing to close. */
  onPress: (() => void) | undefined
  style?: StyleProp<ViewStyle>
  children?: ReactNode
  onLayout?: (event: LayoutChangeEvent) => void
  testID?: string
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessible={false}
      style={style}
      onLayout={onLayout}
      testID={testID}
    >
      {children}
    </Pressable>
  )
}
