import { memo } from 'react'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { formatDuration, type Song } from '@selfmp3/shared'
import { useAccent } from '../accent'
import { colors, radius, space, type } from '../theme'
import { Cover } from './Cover'

/**
 * One song in a list.
 *
 * Memoised because the library list is long and re-renders on every progress
 * tick otherwise — the one place in this app where that actually matters.
 */
export const SongRow = memo(function SongRow({
  song,
  artUri,
  active,
  downloaded,
  onPress,
  onLongPress,
}: {
  song: Song
  artUri: string | null
  active: boolean
  downloaded: boolean
  onPress: () => void
  onLongPress?: () => void
}): ReactNode {
  const accent = useAccent()

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, active && styles.active]}
    >
      <Cover uri={artUri} title={song.album || song.title} />
      <View style={styles.text}>
        <Text style={[styles.title, active && { color: accent.accent }]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {song.artist || 'Unknown artist'}
          {song.album ? ` · ${song.album}` : ''}
        </Text>
      </View>
      <View style={styles.meta}>
        {downloaded ? <View style={styles.downloaded} /> : null}
        <Text style={styles.duration}>{formatDuration(song.duration)}</Text>
      </View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  pressed: {
    backgroundColor: colors.surface2,
  },
  active: {
    backgroundColor: colors.surface2,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.textPrimary,
    fontSize: type.body,
    fontWeight: '500',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: type.small,
    marginTop: 1,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  downloaded: {
    width: 6,
    height: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.good,
  },
  duration: {
    color: colors.textMuted,
    fontSize: type.small,
    fontVariant: ['tabular-nums'],
  },
})
