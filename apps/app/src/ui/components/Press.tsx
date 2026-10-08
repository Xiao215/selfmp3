import { forwardRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, View } from 'react-native'
import type { PressableProps, PressableStateCallbackType, StyleProp, ViewStyle } from 'react-native'
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
 *
 * A tap lets go here, not on Pressable's word. Pressable runs `onPress` at
 * once but lets go of `pressed` (and calls `onPressOut`) on a timer, up to
 * 130 ms after the finger came down; a tap that sets off a long stretch of
 * work holds that timer back for all of it. A tag ticked off in the picker
 * lost its tick at once while the row stayed lit and sunk for three seconds
 * more (Xiao, 2026-10-07). So `onPress` lets go of the look as well, in the
 * same commit as whatever the tap changed.
 */
export const Press = forwardRef<View, PressProps>(function Press(
  { depth = 'control', wrap, onLayout, onPressIn, onPressOut, onPress, style, children, ...rest },
  ref,
): ReactNode {
  const press = usePressScale(PRESS[depth])
  // Let go by `onPress`, ahead of Pressable's own `pressed`; taken back at the next press.
  const [released, setReleased] = useState(false)
  const seen = (state: PressableStateCallbackType): PressableStateCallbackType =>
    released && state.pressed ? { ...state, pressed: false } : state
  return (
    <Animated.View style={[wrap, press.style]} onLayout={onLayout}>
      <Pressable
        ref={ref}
        {...rest}
        style={typeof style === 'function' ? state => style(seen(state)) : style}
        onPressIn={event => {
          setReleased(false)
          press.handlers.onPressIn()
          onPressIn?.(event)
        }}
        onPress={
          onPress &&
          (event => {
            setReleased(true)
            press.handlers.onPressOut()
            onPress(event)
          })
        }
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
