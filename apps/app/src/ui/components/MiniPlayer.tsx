import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { usePlayer } from '../../player/PlayerProvider'
import { useArt } from '../../offline/useArt'
import { useAccent } from '../accent'
import { MINI_PLAYER_HEIGHT, motion, space } from '@selfmp3/client'
import { DevicesSheet } from '../../features/devices/DevicesSheet'
import { Cover } from './Cover'
import { IconButton } from './IconButton'
import { Devices, Next, Pause, Play } from './Icons'

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
  const { theme } = useUnistyles()
  const artFor = useArt()
  const accent = useAccent()
  const player = usePlayer()
  const router = useRouter()
  const song = player.current
  const [devicesOpen, setDevicesOpen] = useState(false)

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
      testID="mini-player"
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

      {/* Where else this could be playing, first in the row as on the web's
          mini player: beside the transport, not buried in a menu. */}
      <IconButton testID="mini-player-devices" onPress={() => setDevicesOpen(true)} label="Devices">
        <Devices size={19} color={theme.colors.textSecondary} />
      </IconButton>
      {/*
        The transport carries whether it is playing in its own testID, rather
        than a separate marker element. A marker with nothing in it has no size,
        and a flow quite reasonably does not count a zero-by-zero view as
        visible — which is how the first run of the smoke flow failed against an
        app that was, on screen, plainly playing.
      */}
      <IconButton
        testID={player.isPlaying ? 'mini-player-playing' : 'mini-player-paused'}
        onPress={player.toggle}
        label={player.isPlaying ? 'Pause' : 'Play'}
      >
        {player.isPlaying ? (
          <Pause size={22} color={theme.colors.textPrimary} />
        ) : (
          <Play size={22} color={theme.colors.textPrimary} />
        )}
      </IconButton>
      <IconButton testID="mini-player-next" onPress={player.next} label="Next">
        <Next size={20} color={theme.colors.textSecondary} />
      </IconButton>

      <DevicesSheet open={devicesOpen} onClose={() => setDevicesOpen(false)} />
    </Animated.View>
  )
}

const styles = StyleSheet.create(theme => ({
  bar: {
    height: MINI_PLAYER_HEIGHT + 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: theme.colors.surface2,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
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
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  artist: {
    color: theme.colors.textMuted,
    fontSize: 11,
  },
}))
