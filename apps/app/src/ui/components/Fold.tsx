import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, View } from 'react-native'
import { motion } from '@selfmp3/client'
import { ease, timing } from '../motion'

/**
 * A section's body that folds away under its head and back: its height slides
 * between nothing and what it takes, fading as it goes, rather than the page
 * jumping by a shelf. Kept drawn until the close has landed. At rest open, it
 * is as tall as it is, so a body that grows — a window widened, more songs —
 * is never clipped to the height it was measured at.
 */
export function Fold({ open, children }: { open: boolean; children: ReactNode }): ReactNode {
  // A height is beyond the native driver, so the fade rides the same JS value.
  const [value] = useState(() => new Animated.Value(open ? 1 : 0))
  const [at, setAt] = useState<'open' | 'closed' | 'moving'>(open ? 'open' : 'closed')
  const [height, setHeight] = useState(0)
  const sent = useRef(open)
  useEffect(() => {
    if (sent.current === open) return
    sent.current = open
    setAt('moving')
    if (open)
      timing(value, 1, motion.slow, () => setAt('open'), { easing: ease.out, native: false })
    else timing(value, 0, motion.base, () => setAt('closed'), { easing: ease.in, native: false })
  }, [open, value])
  const clip = useMemo(
    () => ({
      overflow: 'hidden' as const,
      opacity: value,
      height: value.interpolate({ inputRange: [0, 1], outputRange: [0, height] }),
    }),
    [value, height],
  )

  if (!open && at === 'closed') return null
  return (
    <Animated.View style={open && at === 'open' ? null : clip}>
      <View onLayout={event => setHeight(event.nativeEvent.layout.height)}>{children}</View>
    </Animated.View>
  )
}
