import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'

/**
 * How a ticked row is drawn in every list (Xiao picked B3, 2026-11-11): a
 * faint accent tint, and ticked rows next to each other joined into one band,
 * rounded only at its two ends. Each ticked row had been a rounded slab of its
 * own, so ten in a run read as a wall of colour with seams between them.
 *
 * `above` and `below` say whether the rows touching this one are ticked too;
 * the corners on those sides go square so the tints meet.
 */
export function selectedBand(
  selected: boolean,
  above: boolean,
  below: boolean,
): StyleProp<ViewStyle> {
  if (!selected) return null
  return [styles.band, above && styles.joinedAbove, below && styles.joinedBelow]
}

const styles = StyleSheet.create(theme => ({
  band: { backgroundColor: theme.colors.accentSelected },
  joinedAbove: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  joinedBelow: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
}))
