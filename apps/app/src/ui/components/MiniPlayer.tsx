import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { usePlayer, usePlayerProgress } from '../../player/PlayerProvider'
import { useArt } from '../../offline/useArt'
import { useSongColor } from '../useSongColor'
import {
  currentColorScheme,
  MINI_PLAYER_HEIGHT,
  motion,
  NAV_HEIGHT,
  radius,
  space,
} from '@selfmp3/client'
import { MINI_PLAYER_GAP, navBottom } from '../../shell/bottomInset'
import { Cover } from './Cover'
import { IconButton } from './IconButton'
import { ProgressWash } from './ProgressWash'
import { Next, Queue } from './Icons'
import { floating } from '../surfaces'
import { PlayPauseIcon } from './PlayPauseIcon'

/**
 * The mini player: a card floating over the page, above the tab bar
 * (docs/ui-mock `P04`).
 *
 * Nothing when there is no current track, so the list gets the whole screen
 * until something is playing; then it rises into place. The progress wash:
 * the cover's colour fills the card from the left as the song plays, fading
 * out at its leading edge, with a thin line along its foot. Tapping anywhere
 * but the buttons opens Now Playing. The buttons are Up next, play and next,
 * each a full touch target; Devices lives on Now Playing and in Settings.
 */
export function MiniPlayer(): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt()
  const player = usePlayer()
  const router = useRouter()
  const song = player.current
  const insets = useSafeAreaInsets()
  const songColor = useSongColor(song, song ? artFor(song) : null)

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

  return (
    <Animated.View
      testID="mini-player"
      style={[
        styles.bar,
        { bottom: navBottom(insets.bottom) + NAV_HEIGHT + MINI_PLAYER_GAP },
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
      <View style={styles.clip} pointerEvents="none">
        <MiniProgress color={songColor.color} />
      </View>

      <Pressable
        style={styles.expand}
        onPress={() => router.push('/now-playing')}
        accessibilityRole="button"
        accessibilityLabel={`Open now playing: ${song.title}`}
      />

      <Cover uri={artFor(song)} title={song.album || song.title} size={44} />
      <Animated.View style={[styles.meta, { opacity: words }]} pointerEvents="none">
        <Text style={styles.title} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist || 'Unknown artist'}
        </Text>
      </Animated.View>

      {/* Up next. Until it is a sheet of its own (docs/UI-MIGRATION.md, Phase 6)
          it opens Now Playing with the queue already raised. */}
      <IconButton
        testID="mini-player-queue"
        onPress={() => router.push({ pathname: '/now-playing', params: { panel: 'queue' } })}
        label="Up next"
      >
        <Queue size={20} color={theme.colors.textSecondary} />
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
        <PlayPauseIcon playing={player.isPlaying} size={22} color={theme.colors.textPrimary} />
      </IconButton>
      <IconButton testID="mini-player-next" onPress={player.next} label="Next">
        <Next size={20} color={theme.colors.textSecondary} />
      </IconButton>
    </Animated.View>
  )
}

/**
 * The wash, on its own: the one part of the strip that moves with the song.
 * Every tick redraws this and not the cover, the words and the buttons.
 */
function MiniProgress({ color }: { color: string }): ReactNode {
  const { position, duration } = usePlayerProgress()
  return (
    <ProgressWash
      fraction={duration > 0 ? Math.min(1, position / duration) : 0}
      color={color}
      alpha={currentColorScheme() === 'light' ? 0.18 : 0.26}
      fade={24}
      footLine
    />
  )
}

const styles = StyleSheet.create(theme => ({
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: MINI_PLAYER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: space.sm,
    paddingRight: 4,
    borderRadius: radius.mini,
    // A control's tone over the page; it floats over the list, so it casts
    // the floating shadow (`S2`, "Depth").
    backgroundColor: theme.colors.surface2,
    ...floating(theme.colors),
  },
  // The wash is clipped to the card's corners; the card itself is not, or
  // its shadow would be clipped with it.
  clip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.mini,
    overflow: 'hidden',
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
    marginLeft: 8,
    gap: 1,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  artist: {
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
}))
