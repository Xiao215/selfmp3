import type { ReactNode } from 'react'
import { Text } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { radius, space, type } from '@selfmp3/client'
import { Press } from './Press'

/**
 * The pill in the middle of the phone's Now Playing head, standing in for
 * "Now playing" while something has a say there: the sleep timer's time left,
 * or the room you are in. Something small first, a line of text after it, and
 * a press that opens what it is about. On the round buttons' own fill either
 * side of it, so it reads on any song's colour.
 *
 * `faces` is for a room's faces in front: round, and set closer to the pill's
 * edge than an icon is, so the curve of the faces follows the curve of the pill.
 */
export function HeadPill({
  lead,
  text,
  label,
  onPress,
  faces = false,
  testID,
}: {
  lead: ReactNode
  text: string
  /** What a screen reader says. */
  label: string
  onPress: () => void
  faces?: boolean
  testID?: string
}): ReactNode {
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [
        styles.pill,
        faces ? styles.withFaces : styles.withIcon,
        pressed && styles.pressed,
      ]}
    >
      {lead}
      <Text style={styles.text} numberOfLines={1}>
        {text}
      </Text>
    </Press>
  )
}

const styles = StyleSheet.create(theme => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
    maxWidth: '100%',
    paddingRight: space.md,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  withIcon: { gap: space.tight, paddingLeft: space.md },
  withFaces: { gap: space.sm, paddingLeft: 5 },
  pressed: { backgroundColor: theme.colors.surface3 },
  text: {
    flexShrink: 1,
    color: theme.colors.textPrimary,
    fontSize: type.small,
    fontWeight: '600',
  },
}))
