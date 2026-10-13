import { forwardRef, useMemo } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  ZoomIn,
} from 'react-native-reanimated'
import { StyleSheet } from 'react-native-unistyles'
import { motion } from '@selfmp3/client'
import { EASE_IN_POINTS, EASE_OUT_POINTS } from '../motion.model'
import { useMotionReduced } from '../motion'
import { Check, Minus } from './Icons'
import { Press } from './Press'

/** How small the mark starts before the spring brings it up to size. */
const MARK_FROM = 0.6

/**
 * A round 18-point mark (docs/ui-mock `C04`) that fills with the accent when on, with a dim fill and a
 * dash when only some of what it stands for is on.
 *
 * Given `onChange` and a `label`, it is the control too: a press target round
 * the mark that says it is a checkbox, whether it is ticked, and what it is
 * called. A row that is a checkbox as a whole — a tag in the picker, a change
 * in a review — is a `CheckRow`, with the mark wherever the row puts it.
 *
 * What it shows is React's: the fill and the mark are there when it is on and
 * gone when it is off, and only their coming and going moves — the fill
 * fading in over `motion.fast`, the tick growing from `MARK_FROM` on the
 * spring — as Reanimated's entering and exiting animations, on the UI thread.
 * Not a layer that is always there, faded with `Animated`: a React commit
 * landing while the JavaScript thread is busy puts such a layer's opacity back
 * where the fade began, so quick taps in the tag picker would leave a ticked
 * tag drawn empty and an unticked one half full.
 */
export function Checkbox({
  checked,
  mixed = false,
  onChange,
  label,
  style,
  testID,
}: {
  checked: boolean
  mixed?: boolean
  /** Makes it the control: pressed, it asks to be the other way. */
  onChange?: (checked: boolean) => void
  /** What it ticks, read with its state: "Select Evening". */
  label?: string
  /** The press target's own room round the mark. */
  style?: StyleProp<ViewStyle>
  testID?: string
}): ReactNode {
  if (onChange) {
    return (
      <CheckRow
        checked={checked}
        mixed={mixed}
        label={label ?? ''}
        depth="control"
        onPress={() => onChange(!checked)}
        style={style}
        testID={testID}
      >
        <Mark checked={checked} mixed={mixed} />
      </CheckRow>
    )
  }
  return <Mark checked={checked} mixed={mixed} />
}

/**
 * Something pressed to tick or untick it, as a checkbox to assistive
 * technology: its role, its state — `mixed` when only some of what it
 * stands for is on — and its name. The state is said as `aria-checked` as
 * well, because react-native-web turns `accessibilityState` into nothing a
 * browser reads; half the hand-made checkboxes had remembered that.
 *
 * On `Press`, so it sinks and lets go as everything pressable does; `depth`
 * is a row's by default. Its children are the row: the mark (`Checkbox`)
 * goes wherever the row draws it.
 */
export const CheckRow = forwardRef<
  View,
  Omit<ComponentProps<typeof Press>, 'accessibilityRole' | 'accessibilityState' | 'role'> & {
    checked: boolean
    mixed?: boolean
    label: string
  }
>(function CheckRow({ checked, mixed = false, label, depth = 'row', ...press }, ref): ReactNode {
  const state = checked ? true : mixed ? 'mixed' : false
  return (
    <Press
      ref={ref}
      depth={depth}
      {...press}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: state }}
      aria-checked={state}
      accessibilityLabel={label}
    />
  )
})

/** The circle itself. */
function Mark({ checked, mixed }: { checked: boolean; mixed: boolean }): ReactNode {
  const on = checked || mixed
  const moves = useCheckMoves()

  return (
    // What is already ticked when the box is first drawn is simply there, and
    // a box that leaves with its row takes its tick with it.
    <LayoutAnimationConfig skipEntering skipExiting>
      <View style={styles.box}>
        <View style={styles.ring} pointerEvents="none" />
        {on ? (
          <Animated.View
            entering={moves.fillIn}
            exiting={moves.fillOut}
            pointerEvents="none"
            style={checked ? styles.fillAccent : styles.fillMixed}
          />
        ) : null}
        {on ? (
          <Animated.View entering={moves.markIn} exiting={moves.markOut} pointerEvents="none">
            <Animated.View entering={moves.markGrow}>
              {checked ? (
                <Check size={12} tone="onAccent" />
              ) : (
                <Minus size={12} tone="textPrimary" />
              )}
            </Animated.View>
          </Animated.View>
        ) : null}
      </View>
    </LayoutAnimationConfig>
  )
}

/**
 * The fill and the mark arriving and leaving, built once for every box, or
 * none at all under Reduce Motion. The mark's fade and its grow are two
 * views, so both are Reanimated's own animations, which a browser runs too.
 */
function useCheckMoves(): {
  fillIn?: FadeIn
  fillOut?: FadeOut
  markIn?: FadeIn
  markOut?: FadeOut
  markGrow?: ZoomIn
} {
  const reduced = useMotionReduced()
  return useMemo(() => {
    if (reduced) return {}
    const out = Easing.bezier(...EASE_OUT_POINTS)
    const inward = Easing.bezier(...EASE_IN_POINTS)
    return {
      fillIn: FadeIn.duration(motion.fast).easing(out),
      fillOut: FadeOut.duration(motion.fast).easing(out),
      markIn: FadeIn.duration(motion.fast).easing(out),
      markOut: FadeOut.duration(motion.fast).easing(inward),
      markGrow: ZoomIn.springify()
        .stiffness(motion.spring.stiffness)
        .damping(motion.spring.damping)
        .mass(1)
        .withInitialValues({ transform: [{ scale: MARK_FROM }] }),
    }
  }, [reduced])
}

/** The box, and the layers that fill it, all the same 18-point circle. */
const SHAPE = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  borderRadius: 9,
} as const

/** The ring is the mark itself, not a hairline between two things. */
const RING = 1.5

const styles = StyleSheet.create(theme => ({
  box: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { ...SHAPE, borderWidth: RING, borderColor: theme.colors.borderStrong },
  // Ticked, in the accent, and the half-ticked box: both from the palette, so
  // a list of checkboxes is recoloured by the accent picker without any of
  // them being re-rendered. Each is one whole Unistyles style, never merged
  // with another in an array, so Unistyles can still tell them apart.
  fillAccent: {
    ...SHAPE,
    borderWidth: RING,
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  fillMixed: {
    ...SHAPE,
    borderWidth: RING,
    backgroundColor: theme.colors.accentDim,
    borderColor: theme.colors.accent,
  },
}))
