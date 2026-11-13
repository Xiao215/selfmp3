import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text } from 'react-native'
import type { StyleProp, TextStyle } from 'react-native'
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
 *
 * The head is not seen until the copy is measured (`measured`): drawn beside
 * its cover meanwhile, a long title showed there cut to three lines and then
 * jumped above it a frame or two later. On a phone the copy is read before the
 * first frame is drawn, so nothing waits.
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
  /** Whether the copy has been measured for this title, so the head can be shown. */
  measured: boolean
  /** The hidden copy, drawn anywhere inside the view the cover and the title share. */
  measure: ReactNode
} {
  const fontScale = useFontScale()
  // A copy measured for another title or text size says nothing about this
  // one. The copy is drawn afresh for each (its `key`), so each is measured: a
  // new title the same height as the last would lay out no differently.
  const key = `${fontScale}\u0000${title}`
  const [counted, setCounted] = useState({ key: '', lines: 0 })
  const measured = counted.key === key
  const count = (height: number): void =>
    setCounted({ key, lines: linesAt(height, step, fontScale, headroom(step).paddingTop) })
  const copy = useRef<Text>(null)
  useLayoutEffect(() => {
    copy.current?.measure((_x, _y, _width, height) => {
      if (height > 0) {
        setCounted({ key, lines: linesAt(height, step, fontScale, headroom(step).paddingTop) })
      }
    })
  }, [key, step, fontScale])
  return {
    stacked: measured && counted.lines > 2,
    measured,
    measure: (
      <Text
        key={key}
        ref={copy}
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        onLayout={event => count(event.nativeEvent.layout.height)}
        // As wide as the room beside the cover from the first layout: the
        // view's width less the cover and the gap, with no wait for that width.
        style={[style, styles.copy, { right: cover + gap }]}
      >
        {title}
      </Text>
    ),
  }
}

const styles = StyleSheet.create({
  // Out of sight and out of the way: the width is all it is for.
  copy: { position: 'absolute', top: 0, left: 0, opacity: 0 },
})
