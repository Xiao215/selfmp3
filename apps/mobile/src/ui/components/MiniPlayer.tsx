import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { usePlayer } from '../../player/PlayerProvider'
import { useArt } from '../../offline/useArt'
import { useAccent } from '../accent'
import { colors, MINI_PLAYER_HEIGHT, motion, space } from '@selfmp3/client'
import { Cover } from './Cover'
import { IconButton } from './IconButton'
import { Next, Pause, Play } from './Icons'

/**
 * The compact strip above the tab bar: the web's `.mini-player`.
 *
 * Nothing when there is no current track, so the list gets the full screen
 * until something is playing; then it rises into place. The progress wash is
 * the web's: the accent fills the card from the left as the song plays, with
 * a thin line along its foot. Tapping anywhere but the two transport buttons
 * opens the song's own page, and those two are full touch targets — the only
 * transport on the phone's home screen.
 */
export function MiniPlayer(): ReactNode {
  const artFor = useArt()
  const accent = useAccent()
  const player = usePlayer()
  const router = useRouter()
  const song = player.current

  // Slides up when a song first appears; the words fade over when it changes.
  const [rise] = useState(() => new Animated.Value(0))
  const [words] = useState(() => new Animated.Value(1))
  const shownId = useRef<number | null>(null)

  useEffect(() => {
    if (!song) {
      rise.setValue(0)
      shownId.current = null
      return
    }
    if (shownId.current === null) {
      Animated.timing(rise, {
        toValue: 1,
        duration: motion.slow,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1),
        useNativeDriver: true,
      }).start()
    } else if (shownId.current !== song.id) {
      words.setValue(0)
      Animated.timing(words, { toValue: 1, duration: motion.slow, useNativeDriver: true }).start()
    }
    shownId.current = song.id
  }, [song, rise, words])

  if (!song) return null

  const progress = player.duration > 0 ? Math.min(1, player.position / player.duration) : 0

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          opacity: rise,
          transform: [
            {
              translateY: rise.interpolate({
                inputRange: [0, 1],
                outputRange: [MINI_PLAYER_HEIGHT, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View
        style={[styles.wash, { width: `${progress * 100}%`, backgroundColor: accent.accentWash }]}
        pointerEvents="none"
      >
        <View style={[styles.washLine, { backgroundColor: accent.accent }]} />
      </View>

      <Pressable
        style={styles.expand}
        onPress={() => router.push('/now-playing')}
        accessibilityRole="button"
        accessibilityLabel={`Open now playing: ${song.title}`}
      />

      <Cover uri={artFor(song)} title={song.album || song.title} size={40} />
      <Animated.View style={[styles.meta, { opacity: words }]} pointerEvents="none">
        <Text style={styles.title} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist || 'Unknown artist'}
        </Text>
      </Animated.View>

      <IconButton onPress={player.toggle} label={player.isPlaying ? 'Pause' : 'Play'}>
        {player.isPlaying ? (
          <Pause size={22} color={colors.textPrimary} />
        ) : (
          <Play size={22} color={colors.textPrimary} />
        )}
      </IconButton>
      <IconButton onPress={player.next} label="Next">
        <Next size={20} color={colors.textSecondary} />
      </IconButton>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  bar: {
    height: MINI_PLAYER_HEIGHT + 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: colors.surface2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    overflow: 'hidden',
  },
  wash: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  washLine: {
    height: 2,
  },
  expand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  artist: {
    color: colors.textMuted,
    fontSize: 11,
  },
})
