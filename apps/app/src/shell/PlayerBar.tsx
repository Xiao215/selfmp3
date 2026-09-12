import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { colors, space, type } from '@selfmp3/client'
import { useArt } from '../offline/useArt'
import { usePlayer } from '../player/PlayerProvider'
import { Cover } from '../ui/components/Cover'
import { IconButton } from '../ui/components/IconButton'
import { SeekBar } from '../ui/components/SeekBar'
import { Next, Pause, Play, Prev } from '../ui/components/Icons'

/**
 * The transport across the foot of the desktop layout: the web's `.player-bar`.
 *
 * The same player state the mini player shows, arranged for a width that has
 * room for it — the song on the left, the transport centred, a scrubber that is
 * a real control rather than a progress wash. Under 820 the mini player is what
 * renders instead; neither knows about the other, the shell picks.
 *
 * The panel buttons the web bar carries on its right — lyrics, queue, practice,
 * devices — belong to surfaces phase 4 brings across.
 */
export const PLAYER_BAR_HEIGHT = 72

export function PlayerBar(): ReactNode {
  const player = usePlayer()
  const artFor = useArt()
  const router = useRouter()
  const song = player.current

  if (!song) {
    return (
      <View style={styles.bar} testID="player-bar">
        <Text style={styles.nothing}>Nothing playing</Text>
      </View>
    )
  }

  return (
    <View style={styles.bar} testID="player-bar">
      <Pressable
        style={styles.song}
        onPress={() => router.push('/now-playing')}
        accessibilityRole="button"
        accessibilityLabel={`Open now playing: ${song.title}`}
      >
        <Cover uri={artFor(song)} title={song.album || song.title} size={44} />
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            {song.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist || 'Unknown artist'}
          </Text>
        </View>
      </Pressable>

      <View style={styles.centre}>
        <View style={styles.transport}>
          <IconButton onPress={player.previous} label="Previous">
            <Prev size={20} color={colors.textSecondary} />
          </IconButton>
          <IconButton onPress={player.toggle} label={player.isPlaying ? 'Pause' : 'Play'}>
            {player.isPlaying ? (
              <Pause size={24} color={colors.textPrimary} />
            ) : (
              <Play size={24} color={colors.textPrimary} />
            )}
          </IconButton>
          <IconButton onPress={player.next} label="Next">
            <Next size={20} color={colors.textSecondary} />
          </IconButton>
        </View>
        <SeekBar position={player.position} duration={player.duration} onSeek={player.seekTo} />
      </View>

      {/* Balances the song block so the transport sits centred on the bar. */}
      <View style={styles.song} pointerEvents="none" />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    height: PLAYER_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  song: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    width: 240,
    minWidth: 0,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
  },
  artist: {
    color: colors.textMuted,
    fontSize: type.small,
  },
  centre: {
    flex: 1,
    alignItems: 'center',
    gap: space.xs,
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  nothing: {
    color: colors.textMuted,
    fontSize: type.small,
  },
})
