import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { motion } from '@selfmp3/client'
import { spring, usePresence } from '../motion'
import { Check, Minus } from './Icons'

/** How small the mark starts before the spring brings it up to size. */
const MARK_FROM = 0.6

/**
 * A round 18-point mark (docs/ui-mock `C04`) that fills with the accent when on, with a dim fill and a
 * dash when only some of what it stands for is on.
 *
 * Only the mark. The thing you press, and what it is called, belong to the
 * caller — a row's checkbox, the selection bar's select-all and a tag
 * picker's row are different controls that happen to draw the same circle.
 *
 * One view tree, not one per state: the ring is always there, the fill is a
 * layer over it whose opacity fades in over `motion.fast`, and the tick grows
 * from `MARK_FROM` on the spring. It used to be three unrelated trees, so every
 * tick in a list of songs was a hard cut in both directions. The fill's colour
 * is crossfaded as an opacity rather than animated as a colour, so it can ride
 * the native driver.
 */
export function Checkbox({
  checked,
  mixed = false,
}: {
  checked: boolean
  mixed?: boolean
}): ReactNode {
  const on = checked || mixed
  // One value for the fill and the mark: both fade with it, and the mark is
  // kept for as long as its fade out takes, so unticking animates rather than
  // cutting the tick away.
  const { mounted, progress } = usePresence(on, motion.fast, motion.fast)
  const [pop] = useState(() => new Animated.Value(on ? 1 : 0))
  useEffect(() => {
    if (on) {
      spring(pop, 1)
      return
    }
    // Only once the mark has gone: reset it while it was still fading and the
    // tick would shrink in one frame in the middle of its own exit.
    if (!mounted) pop.setValue(0)
  }, [on, mounted, pop])

  const mark = useMemo(
    () => ({
      opacity: progress,
      transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [MARK_FROM, 1] }) }],
    }),
    [progress, pop],
  )
  const lit = useMemo(() => ({ opacity: progress }), [progress])

  return (
    <View style={styles.box}>
      <View style={styles.ring} pointerEvents="none" />
      <Animated.View
        pointerEvents="none"
        style={[checked ? styles.fillAccent : styles.fillMixed, lit]}
      />
      {mounted ? (
        <Animated.View style={mark} pointerEvents="none">
          {checked ? <Check size={12} tone="onAccent" /> : <Minus size={12} tone="textPrimary" />}
        </Animated.View>
      ) : null}
    </View>
  )
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
  // them being re-rendered. Each is one whole
  // Unistyles style, because an `Animated.View` flattens its style array and
  // Unistyles can no longer tell two of its own styles apart once merged.
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
