import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { withAlpha } from '@selfmp3/client'
import { lookInk, type LookId } from '../looks.model'

/*
 * The days the calendar's sketch fills in, by cell: a run of three and two
 * strays, so it reads as a month that was listened to rather than a pattern.
 */
const CALENDAR_LIT = new Set([4, 5, 6, 12, 17])

/**
 * A look drawn the size of a thumbnail, in its own inks: the masthead over
 * three columns, the big number, the till's lines, a month of dots, a few
 * lines of words. Front page and Paper are printed on the page's own cream,
 * so on the light theme a plain swatch of their paper is no swatch at all;
 * the sketch is what tells one look from another. The wall has none — its
 * swatch is its number one's cover.
 */
export function LookSketch({
  look,
  hue,
  wide,
}: {
  look: LookId
  hue: number
  wide: boolean
}): ReactNode {
  const ink = lookInk(look, hue)
  const strong = { backgroundColor: ink.ink }
  const faint = { backgroundColor: withAlpha(ink.ink, 0.3) }

  if (look === 'front') {
    return (
      <View style={styles.sketch}>
        <View style={[styles.masthead, strong]} />
        <View style={[styles.rule, strong]} />
        <View style={styles.columns}>
          {[3, 2, 2].map((lines, column) => (
            <View key={column} style={styles.column}>
              {Array.from({ length: lines }, (_, i) => (
                <View key={i} style={[styles.line, faint, i === lines - 1 && styles.lineShort]} />
              ))}
            </View>
          ))}
        </View>
      </View>
    )
  }

  if (look === 'paper') {
    return (
      <View style={[styles.sketch, styles.centred]}>
        <View style={[styles.line, faint, { width: '40%' }]} />
        <View style={[styles.figure, strong]} />
        <View style={[styles.line, faint, { width: '70%' }]} />
      </View>
    )
  }

  if (look === 'receipt') {
    return (
      <View style={[styles.sketch, styles.slip]}>
        <View style={[styles.line, strong, styles.centered, { width: '60%' }]} />
        <View style={[styles.tear, { borderColor: withAlpha(ink.ink, 0.4) }]} />
        <View style={[styles.line, faint]} />
        <View style={[styles.line, faint]} />
        <View style={[styles.tear, { borderColor: withAlpha(ink.ink, 0.4) }]} />
        <View style={[styles.line, strong]} />
      </View>
    )
  }

  if (look === 'calendar') {
    // A month is seven across; the phone's swatch is tall and narrow, so five.
    const columns = wide ? 7 : 5
    const rows = wide ? 3 : 5
    return (
      <View style={[styles.sketch, styles.month]}>
        {Array.from({ length: rows }, (_, row) => (
          <View key={row} style={styles.week}>
            {Array.from({ length: columns }, (_, day) => {
              const lit = CALENDAR_LIT.has(row * columns + day)
              return (
                <View
                  key={day}
                  style={[
                    styles.dot,
                    lit
                      ? [styles.dotLit, { backgroundColor: ink.accent }]
                      : { backgroundColor: withAlpha(ink.ink, 0.35) },
                  ]}
                />
              )
            })}
          </View>
        ))}
      </View>
    )
  }

  if (look === 'words') {
    // The sentence, with its one run in the accent's italic.
    const words = { backgroundColor: withAlpha(ink.ink, 0.7) }
    return (
      <View style={[styles.sketch, styles.centred]}>
        <View style={[styles.line, words, { width: '85%' }]} />
        <View style={[styles.line, { backgroundColor: ink.accent, width: '55%' }]} />
        <View style={[styles.line, words, { width: '70%' }]} />
      </View>
    )
  }

  return null
}

const styles = StyleSheet.create({
  sketch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 6,
    paddingHorizontal: 7,
    gap: 3,
  },
  line: { height: 2, borderRadius: 1 },
  lineShort: { width: '65%' },
  masthead: { height: 5, width: '60%', alignSelf: 'center', borderRadius: 1 },
  rule: { height: 1.5 },
  columns: { flex: 1, flexDirection: 'row', gap: 3 },
  column: { flex: 1, gap: 2 },
  figure: { height: 10, width: '55%', borderRadius: 2 },
  slip: { paddingHorizontal: 12, justifyContent: 'center' },
  centered: { alignSelf: 'center' },
  tear: { borderTopWidth: 1.5, borderStyle: 'dashed', marginVertical: 1 },
  month: { justifyContent: 'center', gap: 3 },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  dot: { width: 4, height: 4, borderRadius: 2 },
  dotLit: { transform: [{ scale: 1.4 }] },
  centred: { justifyContent: 'center' },
})
