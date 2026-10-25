import { useCallback, useRef, useState } from 'react'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

/** What a page of tiles draws at first, and how many more each time its end comes near. */
const STEP = 48

/**
 * How many of a long run of tiles or rows to draw: a screenful or two to
 * begin with, and more as the scroll comes within two screens of the end.
 * Spread on the ScrollView that holds them.
 *
 * Five hundred tags drew every tile at once, a second and a half before the
 * page answered, and the tag picker drew every row for each letter typed
 * (bug bash F171). `restart` names what is being drawn — the words typed —
 * and a new one starts again from the top.
 */
export function useDrawnAhead(
  total: number,
  restart: unknown = null,
): {
  readonly drawn: number
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  readonly onLayout: (event: LayoutChangeEvent) => void
  readonly onContentSizeChange: (width: number, height: number) => void
  readonly scrollEventThrottle: number
} {
  const [state, setState] = useState({ restart, drawn: STEP })
  // A new answer starts from the top, set while rendering so it is never drawn whole first.
  const drawnNow = state.restart === restart ? state.drawn : STEP
  if (state.restart !== restart) setState({ restart, drawn: STEP })
  const viewport = useRef(0)
  const content = useRef(0)
  const offset = useRef(0)
  const more = useCallback(() => {
    if (content.current - offset.current > viewport.current * 3) return
    setState(now => (now.drawn >= total ? now : { ...now, drawn: now.drawn + STEP }))
  }, [total])
  return {
    drawn: Math.min(drawnNow, total),
    onScroll: event => {
      offset.current = event.nativeEvent.contentOffset.y
      viewport.current = event.nativeEvent.layoutMeasurement.height
      content.current = event.nativeEvent.contentSize.height
      more()
    },
    onLayout: event => {
      viewport.current = event.nativeEvent.layout.height
      more()
    },
    // What is drawn not reaching far enough past the screen draws more.
    onContentSizeChange: (_width, height) => {
      content.current = height
      if (viewport.current > 0) more()
    },
    scrollEventThrottle: 100,
  }
}
