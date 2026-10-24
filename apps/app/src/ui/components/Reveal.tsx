import type { ReactNode } from 'react'
import { Animated } from 'react-native'
import { useFade } from '../motion'
import { MOVE_MS } from '../motion.model'

/**
 * A row's controls with a mouse (`M3`, 3): they fade in over 100 ms as the
 * pointer arrives and out over 140 as it leaves. Only the desktop's rows draw
 * these, so a phone's list carries no animated value per row.
 */
export function Reveal({ shown, children }: { shown: boolean; children: ReactNode }): ReactNode {
  const opacity = useFade(shown, MOVE_MS.hoverIn, MOVE_MS.hoverOut)
  return <Animated.View style={{ opacity }}>{children}</Animated.View>
}
