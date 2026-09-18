import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated } from 'react-native'
import { Pause, Play } from './Icons'
import { timing } from '../motion'

/** How long the swap takes, all of it (docs/ui-mock `M1`, "Play ⇄ pause"). */
const SWAP_MS = 180

/**
 * Play or Pause, turning and shrinking through the swap: the old glyph turns a
 * quarter and shrinks to nothing, the new one grows back from the other side,
 * 180 ms in all. Under Reduce Motion it simply changes.
 *
 * Only the glyph; the button around it is the caller's.
 */
export function PlayPauseIcon({
  playing,
  size,
  color,
}: {
  playing: boolean
  size: number
  color: string
}): ReactNode {
  const [shown, setShown] = useState(playing)
  const [turn] = useState(() => new Animated.Value(1))

  useEffect(() => {
    if (playing === shown) return
    // Out to nothing, swap the glyph at the bottom of the dip, and back in.
    // Under Reduce Motion both halves land at once and the glyph just changes.
    const out = timing(turn, 0, SWAP_MS / 2, () => {
      setShown(playing)
      timing(turn, 1, SWAP_MS / 2)
    })
    return () => out?.stop()
  }, [playing, shown, turn])

  const style = {
    transform: [
      { scale: turn.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
      { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] }) },
    ],
    opacity: turn,
  }

  return (
    <Animated.View style={style}>
      {shown ? <Pause size={size} color={color} /> : <Play size={size} color={color} />}
    </Animated.View>
  )
}
