import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text } from 'react-native'
import type { LayoutChangeEvent, StyleProp, TextStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { TypeStep } from '@selfmp3/client'
import { headroom } from './surfaces'
import { linesAt, useFontScale } from './textScale'

/**
 * Whether a head's title still reads beside its cover, or the cover goes
 * above it (AM1): a song's page set "月に吠える - Howl At The Moon" in three
 * lines of four letters beside its cover at large text.
 *
 * Measured by a hidden copy of the title at the width it would have beside
 * the cover — the head's width less the cover and the gap, which stacking does
 * not change — so the answer does not flip back once the title has the whole
 * width. More than two lines there, and the cover goes above.
 */
export function useStackedTitle({
  title,
  step,
  style,
  cover,
  gap,
}: {
  title: string
  /** The title's type step, for its line height. */
  step: TypeStep
  style: StyleProp<TextStyle>
  /** The cover's width beside the title, and the room between them. */
  cover: number
  gap: number
}): {
  stacked: boolean
  /** On the view the cover and the title share. */
  onHeadLayout: (event: LayoutChangeEvent) => void
  /** The hidden copy, drawn anywhere inside that view. */
  measure: ReactNode
} {
  const fontScale = useFontScale()
  const [width, setWidth] = useState(0)
  const beside = Math.floor(width - cover - gap)
  // A copy measured for another title, width or text size says nothing about this one.
  const key = `${beside}\u0000${fontScale}\u0000${title}`
  const [measured, setMeasured] = useState({ key: '', lines: 0 })
  const lines = measured.key === key ? measured.lines : 0
  return {
    stacked: lines > 2,
    onHeadLayout: event => setWidth(event.nativeEvent.layout.width),
    measure:
      beside > 0 ? (
        <Text
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          onLayout={event =>
            setMeasured({
              key,
              lines: linesAt(
                event.nativeEvent.layout.height,
                step,
                fontScale,
                headroom(step).paddingTop,
              ),
            })
          }
          style={[style, styles.copy, { width: beside }]}
        >
          {title}
        </Text>
      ) : null,
  }
}

const styles = StyleSheet.create({
  // Out of sight and out of the way: the width is all it is for.
  copy: { position: 'absolute', top: 0, left: 0, opacity: 0 },
})
