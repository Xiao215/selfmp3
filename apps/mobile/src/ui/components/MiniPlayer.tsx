import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { mediaUrl } from '../../api/client'
import { usePlayer } from '../../player/PlayerProvider'
import { useConnection } from '../../server/ConnectionProvider'
import { useAccent } from '../accent'
import { colors, MINI_PLAYER_HEIGHT, space, type } from '../theme'
import { Cover } from './Cover'
import { Glyph } from './Glyph'

/**
 * The bar above the tab bar. Nothing when there is no current track, so the
 * list gets the full screen until something is playing.
 */
export function MiniPlayer(): ReactNode {
  const accent = useAccent()
  const player = usePlayer()
  const { connection } = useConnection()
  const router = useRouter()

  const song = player.current
  if (!song) return null

  const progress = player.duration > 0 ? player.position / player.duration : 0

  return (
    <Pressable style={styles.bar} onPress={() => router.push('/now-playing')}>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.min(progress, 1) * 100}%`, backgroundColor: accent.accent },
          ]}
        />
      </View>

      <View style={styles.content}>
        <Cover
          uri={song.hasArt && connection ? mediaUrl.art(connection, song.id, song.rev) : null}
          title={song.album || song.title}
          size={38}
        />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {song.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {song.artist || 'Unknown artist'}
          </Text>
        </View>

        <Pressable
          hitSlop={10}
          onPress={event => {
            event.stopPropagation()
            player.toggle()
          }}
        >
          <Glyph name={player.isPlaying ? 'pause' : 'play'} size={20} />
        </Pressable>
        <Pressable
          hitSlop={10}
          onPress={event => {
            event.stopPropagation()
            player.next()
          }}
        >
          <Glyph name="next" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: {
    height: MINI_PLAYER_HEIGHT,
    backgroundColor: colors.surface1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  progressTrack: {
    height: 2,
    backgroundColor: colors.surface3,
  },
  progressFill: {
    height: 2,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.textPrimary,
    fontSize: type.small,
    fontWeight: '600',
  },
  artist: {
    color: colors.textMuted,
    fontSize: type.tiny,
  },
})
