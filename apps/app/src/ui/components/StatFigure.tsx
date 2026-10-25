import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, type } from '@selfmp3/client'
import { serif, textColumn } from '../surfaces'
import { FIT_FIGURE, useLargeText } from '../textScale'

/**
 * One headline number on a card: big in the serif, its unit set smaller beside
 * it ("42 min", "9 days"), and what it counts under it. Home's This week and
 * You's month card, which show the same three numbers (`statFigures`).
 *
 * The number shrinks to fit its room rather than being cut, as large text
 * would otherwise cut "18h 53" to "18h…" (AM1). `StatFigures` lays the three.
 */
export function StatFigure({
  value,
  unit,
  caption,
}: {
  value: string
  unit?: string
  caption: string
}): ReactNode {
  const large = useLargeText()
  return (
    <View style={[styles.figure, large && styles.figureLarge]}>
      <Text style={styles.value} {...FIT_FIGURE}>
        {value}
        {unit ? <Text style={styles.unit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  )
}

/**
 * The three side by side, or at the largest text sizes one under another,
 * where a third of the card is no room for "listened" (AM1).
 */
export function StatFigures({ children }: { children: ReactNode }): ReactNode {
  const large = useLargeText()
  return <View style={large ? styles.column : styles.row}>{children}</View>
}

const styles = StyleSheet.create(theme => ({
  row: { flexDirection: 'row', gap: space.md },
  column: { gap: space.md },
  figure: textColumn,
  // In a column a figure is as tall as its words, not a share of nothing.
  figureLarge: { flex: 0 },
  value: serif(theme.colors, 'page'),
  unit: { fontSize: type.section, color: theme.colors.textSecondary },
  caption: { color: theme.colors.textSecondary, fontSize: type.small },
}))
