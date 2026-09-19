import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { radius, type, withAlpha } from '@selfmp3/client'

/**
 * "Tagging · 3 to go", with Stop beside it: the quiet mark that the page is
 * in play-and-tag, so the editor coming back after every song reads as a mode
 * and not as the page misbehaving, and leaving it is one tap away.
 */
export function TaggingLine({
  line,
  onStop,
  center = false,
}: {
  line: string
  onStop: () => void
  /** Centred in the phone's head, where it stands in for the queue's line. */
  center?: boolean
}): ReactNode {
  return (
    <View style={[styles.row, center && styles.rowCenter]} testID="now-playing-tagging">
      <Text style={styles.text} numberOfLines={1}>
        {line}
      </Text>
      <Pressable
        onPress={onStop}
        accessibilityRole="button"
        accessibilityLabel="Stop tagging"
        hitSlop={8}
        style={({ pressed }) => [styles.stop, pressed && styles.stopPressed]}
      >
        <Text style={styles.stopText}>Stop</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  rowCenter: { flex: 1, justifyContent: 'center' },
  text: { flexShrink: 1, color: theme.colors.textSecondary, fontSize: type.small },
  stop: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.08),
  },
  stopPressed: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.14) },
  stopText: { color: theme.colors.textSecondary, fontSize: type.small, fontWeight: '600' },
}))
