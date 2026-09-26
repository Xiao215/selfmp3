import { forwardRef } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, View } from 'react-native'
import type { PressableProps, StyleProp, ViewStyle } from 'react-native'
import { PRESS } from '../motion.model'
import { usePressScale } from '../motion'

/**
 * The one Pressable (docs/ui-mock `M1`, 1): whatever it is, it sinks under
 * the finger on the spring and comes back on release. A control sinks to
 * 0.96; a row, wide enough that 0.96 would walk its ends, to 0.985.
 *
 * The scale is on a view around the Pressable, because a Pressable's style
 * function cannot carry an animated value; `wrap` is that view's own layout
 * (a flex, a width), and `style` is the Pressable's, as it always was.
 * `onLayout` reports the wrapper, which is where the thing is on the screen
 * (a sliding highlight measures its items by it) — the Pressable inside is
 * always at 0, 0 of it.
 */
export const Press = forwardRef<View, PressProps>(function Press(
  { depth = 'control', wrap, onLayout, onPressIn, onPressOut, children, ...rest },
  ref,
): ReactNode {
  const press = usePressScale(PRESS[depth])
  return (
    <Animated.View style={[wrap, press.style]} onLayout={onLayout}>
      <Pressable
        ref={ref}
        {...rest}
        onPressIn={event => {
          press.handlers.onPressIn()
          onPressIn?.(event)
        }}
        onPressOut={event => {
          press.handlers.onPressOut()
          onPressOut?.(event)
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  )
})

interface PressProps extends PressableProps {
  /** How far it sinks: a control (the default) or a row. */
  depth?: keyof typeof PRESS
  /** The layout of the view that carries the scale: `flex: 1`, a width. */
  wrap?: StyleProp<ViewStyle>
  children?: ReactNode
}
