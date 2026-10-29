import { forwardRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type View,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { OPACITY, PRESS } from '../motion.model'
import { usePressScale } from '../motion'
import { ariaFor, spacePresses } from '../pressA11y.model'
import { browserKeys } from '../../ports/browserKeys'

/**
 * The one Pressable (docs/ui-mock `M1`, 1). Whatever it is answers the finger
 * in one of three ways, each with one value for the whole app:
 *
 * - `sink` (the default): it sinks on the spring and comes back on release. A
 *   control sinks to 0.96; a row, wide enough that 0.96 would walk its ends,
 *   to 0.985. Buttons, pills, tiles, cards — anything with a shape of its own.
 * - `wash`: the ink's veil lies over it while pressed, and it stays put. A
 *   bare row on the page — a menu's, the sidebar's, a search result — which
 *   has no ground of its own to sink.
 * - `dim`: it fades to `OPACITY.pressed`. Bare ink: a text link, an icon with
 *   no round behind it.
 *
 * A sink's scale is on a view around the Pressable, because a Pressable's
 * style function cannot carry an animated value; `wrap` is that view's own
 * layout (a flex, a width), and `style` is the Pressable's. `onLayout` reports
 * the wrapper, which is where the thing is on the screen (a sliding highlight
 * measures its items by it) — the Pressable inside is always at 0, 0 of it.
 * A wash or a dim has no wrapper: the Pressable is laid out as it would be
 * on its own.
 *
 * In a browser it also says its state and value to screen readers, which
 * react-native-web leaves unsaid (`pressA11y.model.ts`), and Space works a
 * switch, a radio, a tab or a menu's item as Enter does.
 *
 * A tap lets go here, not on Pressable's word. Pressable runs `onPress` at
 * once but lets go of `pressed` (and calls `onPressOut`) on a timer, up to
 * 130 ms after the finger came down; a tap that sets off a long stretch of
 * work holds that timer back for all of it: a tag ticked off in the picker
 * would lose its tick at once while the row stayed lit and sunk for seconds
 * more. So `onPress` lets go of the look as well, in the
 * same commit as whatever the tap changed.
 */
export const Press = forwardRef<View, PressProps>(function Press(
  {
    feedback = 'sink',
    depth = 'control',
    wrap,
    onLayout,
    onPressIn,
    onPressOut,
    onPress,
    style,
    children,
    ...rest
  },
  ref,
): ReactNode {
  const press = usePressScale(PRESS[depth])
  const sinks = feedback === 'sink'
  // Let go by `onPress`, ahead of Pressable's own `pressed`; taken back at the next press.
  const [released, setReleased] = useState(false)
  const seen = (state: PressableStateCallbackType): PressableStateCallbackType =>
    released && state.pressed ? { ...state, pressed: false } : state
  const look = feedback === 'wash' ? styles.wash : feedback === 'dim' ? styles.dim : null
  const role = (rest.role ?? rest.accessibilityRole) as string | undefined
  const web = browserKeys
    ? {
        ...ariaFor(role, rest.accessibilityState ?? undefined, rest.accessibilityValue),
        ...(onPress && spacePresses(role)
          ? {
              onKeyDown: (event: WebKeyEvent) => {
                rest.onKeyDown?.(event)
                if (event.key !== ' ' || event.target !== event.currentTarget) return
                event.preventDefault()
                if (event.repeat || rest.disabled) return
                setReleased(true)
                onPress(event as unknown as GestureResponderEvent)
              },
            }
          : null),
      }
    : null
  const pressable = (
    <Pressable
      ref={ref}
      {...web}
      {...rest}
      {...(web?.onKeyDown ? { onKeyDown: web.onKeyDown } : null)}
      onLayout={sinks ? undefined : onLayout}
      style={
        typeof style === 'function' || look
          ? state => {
              const now = seen(state)
              const own = typeof style === 'function' ? style(now) : style
              return look && now.pressed ? [own, look] : own
            }
          : style
      }
      onPressIn={event => {
        setReleased(false)
        if (sinks) press.handlers.onPressIn()
        onPressIn?.(event)
      }}
      onPress={
        onPress &&
        (event => {
          setReleased(true)
          if (sinks) press.handlers.onPressOut()
          onPress(event)
        })
      }
      onPressOut={event => {
        if (sinks) press.handlers.onPressOut()
        onPressOut?.(event)
      }}
    >
      {children}
    </Pressable>
  )
  if (!sinks) return pressable
  return (
    <Animated.View style={[wrap, press.style]} onLayout={onLayout}>
      {pressable}
    </Animated.View>
  )
})

/** A browser's key event, as react-native-web hands it to `onKeyDown`. */
type WebKeyEvent = KeyboardEvent<Element>

interface PressProps extends PressableProps {
  /** A browser's own key event, which react-native-web passes on. */
  onKeyDown?: (event: WebKeyEvent) => void
  /** How it answers a press: sinks (the default), a veil over it, or its ink fading. */
  feedback?: 'sink' | 'wash' | 'dim'
  /** How far a sink goes: a control (the default) or a row. */
  depth?: keyof typeof PRESS
  /** A sink's layout of the view that carries the scale: `flex: 1`, a width. */
  wrap?: StyleProp<ViewStyle>
  children?: ReactNode
}

const styles = StyleSheet.create(theme => ({
  // The ink's own veil rather than a surface: it reads on any ground, a song's colour as well.
  wash: { backgroundColor: theme.colors.veilPressed },
  dim: { opacity: OPACITY.pressed },
}))
