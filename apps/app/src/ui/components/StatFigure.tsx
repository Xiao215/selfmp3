import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { type } from '@selfmp3/client'
import { serif } from '../surfaces'

/**
 * One headline number on a card: big in the serif, its unit set smaller beside
 * it ("42 min", "9 days"), and what it counts under it. Home's This week and
 * You's month card, which show the same three numbers (`statFigures`).
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
  return (
    <View style={styles.figure}>
      <Text style={styles.value} numberOfLines={1}>
        {value}
        {unit ? <Text style={styles.unit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  figure: { flex: 1, minWidth: 0, gap: 2 },
  value: { ...serif(theme.colors, type.page), lineHeight: 34 },
  unit: { fontSize: type.section, color: theme.colors.textSecondary },
  caption: { color: theme.colors.textSecondary, fontSize: type.small },
}))
