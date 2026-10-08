import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { AccessibilityRole, StyleProp, TextStyle, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { radius, space, type } from '@selfmp3/client'
import { Cover } from './Cover'
import { Press } from './Press'

/** A song line's cover: one size wherever a song is drawn small. */
export const SONG_LINE_COVER = 36

/**
 * The compact song line (proposal P1, 2026-10-08): a 36 cover, the title, a
 * line under it, and whatever the place needs at the end — a time, a ×, a
 * play mark. For the places a song is mentioned rather than listed: a sheet
 * picking songs, the palette, Up next's rail, Ask's answers, a profile's
 * month. There were a dozen of these with nine cover sizes between them.
 *
 * It is not `SongRow`. A list of songs — Library, a playlist, a tag, the
 * Songs of a search — is drawn with that, the row with the heart, the tags and
 * the ⋯; this is the line that names a song somewhere else.
 *
 * Given `onPress` it is pressable, sinking as a row does; without, it is the
 * face alone, for a row whose press, hold and keys a screen owns (the rail's).
 * `cover` stands in for the picture — the rail's playing song wears its
 * equaliser over it — and `leading` goes before it (a grip).
 */
export function SongLine({
  title,
  sub,
  artUri,
  coverTitle,
  cover,
  leading,
  trailing,
  titleStyle,
  onPress,
  onLongPress,
  disabled,
  accessibilityLabel,
  accessibilityRole = 'button',
  testID,
  style,
}: {
  title: ReactNode
  sub?: ReactNode
  artUri?: string | null | undefined
  /** What the letter tile is drawn from, when there is no picture: the album, or the title. */
  coverTitle?: string
  cover?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  /** The title's colour, when the song's own: the playing song's tint. */
  titleStyle?: StyleProp<TextStyle>
  onPress?: () => void
  onLongPress?: () => void
  disabled?: boolean
  accessibilityLabel?: string
  accessibilityRole?: AccessibilityRole
  testID?: string
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const face = (
    <>
      {leading}
      {cover ?? (
        <Cover
          uri={artUri}
          title={coverTitle ?? (typeof title === 'string' ? title : '')}
          size={SONG_LINE_COVER}
        />
      )}
      <View style={styles.text}>
        <Text style={[styles.title, titleStyle]} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {trailing}
    </>
  )
  if (!onPress) {
    return (
      <View style={[styles.line, style]} testID={testID}>
        {face}
      </View>
    )
  }
  return (
    <Press
      depth="row"
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [styles.line, style, pressed && styles.pressed]}
    >
      {face}
    </Press>
  )
}

const styles = StyleSheet.create(theme => ({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.cover,
  },
  pressed: { backgroundColor: theme.colors.surface2 },
  text: { flex: 1, minWidth: 0, gap: 1 },
  title: { color: theme.colors.textPrimary, fontSize: type.sub, fontWeight: '600' },
  sub: { color: theme.colors.textSecondary, fontSize: type.small },
}))
