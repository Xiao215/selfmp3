import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { type } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'

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
      <Button
        size="small"
        ground="translucent"
        label="Stop"
        accessibilityLabel="Stop tagging"
        onPress={onStop}
      />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  rowCenter: { flex: 1, justifyContent: 'center' },
  text: { flexShrink: 1, color: theme.colors.textSecondary, fontSize: type.small },
}))
