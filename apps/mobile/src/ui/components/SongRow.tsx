import { memo } from 'react'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { formatDuration, type Song } from '@selfmp3/shared'
import { useAccent } from '../accent'
import { colors, radius, space, type } from '../theme'
import { Cover } from './Cover'
import { Downloaded, Heart } from './Icons'
import { Equalizer } from './Equalizer'

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
  playing = false,
  onPress,
  onLongPress,
  onToggleLoved,
}: {
  song: Song
  artUri: string | null
  active: boolean
  downloaded: boolean
  /** Whether the song is the one actually sounding, for the equaliser. */
  playing?: boolean
  onPress: () => void
  onLongPress?: () => void
  onToggleLoved?: () => void
}): ReactNode {
  const accent = useAccent()

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, active && styles.active]}
    >
      <View>
        <Cover uri={artUri} title={song.album || song.title} />
        {active ? (
          <View style={styles.playingOverlay}>
            <Equalizer paused={!playing} size={12} />
          </View>
        ) : null}
      </View>

      <View style={styles.text}>
        <Text style={[styles.title, active && { color: accent.accent }]} numberOfLines={1}>
          {song.title}
        </Text>
        <View style={styles.subtitleRow}>
          {/* The web calls this "On this device", and draws exactly this. */}
          {downloaded ? <Downloaded size={13} color={accent.accent} knockout={colors.surface0} /> : null}
          <Text style={styles.subtitle} numberOfLines={1}>
            {song.artist || 'Unknown artist'}
            {song.album ? ` · ${song.album}` : ''}
          </Text>
        </View>
      </View>

      {onToggleLoved ? (
        <Pressable onPress={onToggleLoved} hitSlop={8} style={styles.loveButton}>
          <Heart
            size={18}
            filled={song.loved}
            color={song.loved ? accent.accent : colors.textSecondary}
          />
        </Pressable>
      ) : null}
      <Text style={styles.duration}>{formatDuration(song.duration)}</Text>
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
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  playingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.sm,
  },
  loveButton: { padding: space.xs },
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
