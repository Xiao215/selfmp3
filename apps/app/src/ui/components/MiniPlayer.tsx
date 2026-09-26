import { memo, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import type { Song } from '@selfmp3/shared'
import { usePlayer, usePlayerProgress, usePlayerStalled } from '../../player/PlayerProvider'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
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
import { openQueueSheet } from '../../features/queue/queueSheet.store'
import { Cover } from './Cover'
import { IconButton } from './IconButton'
import { ProgressWash } from './ProgressWash'
import { Next, Queue } from './Icons'
import { floating } from '../surfaces'
import { PlayPauseIcon } from './PlayPauseIcon'
import { handOffCover } from '../coverHandoff'
import { ease, session, timing, usePressScale } from '../motion'
import { MOVE_MS, overshootRange, PRESS } from '../motion.model'

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
function MiniPlayerInner(): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt(ROW_COVER_SIZE)
  const player = usePlayer()
  const router = useRouter()
  const song = player.current
  const insets = useSafeAreaInsets()
  const stalled = usePlayerStalled()

  // The first song of a session: the card rises from under the tab bar and
  // runs a few points past its place before settling (`M1`, 3). After that the
  // card is simply there — coming back from Now Playing remounts it, and it
  // should not arrive twice. When the queue empties the card sinks back under
  // the bar the way it came, quicker, and only then goes; the last song is
  // kept drawn on it for the way down. The next song is a new arrival.
  const [rise] = useState(() => new Animated.Value(song && session.seen(RISE_KEY) ? 1 : 0))
  const [shown, setShown] = useState<Song | null>(song)
  if (song && song !== shown) setShown(song)
  const [sinking, setSinking] = useState(false)
  const shownId = useRef<number | null>(null)
  // Which way the words go as the song changes: up and away for the next
  // song, down for the one before, told by where the two sit in the queue.
  const index = player.queue.index
  const lastIndex = useRef(index)
  const [words] = useState(() => new Animated.Value(1))
  const [wordsWay] = useState(() => new Animated.Value(1))
  const [wordsMove] = useState(() => ({
    opacity: words,
    transform: [
      {
        translateY: Animated.multiply(
          words.interpolate({ inputRange: [0, 1], outputRange: [WORDS_STEP, 0] }),
          wordsWay,
        ),
      },
    ],
  }))
  const [leaving, setLeaving] = useState<Song | null>(null)
  const [gone] = useState(() => new Animated.Value(0))
  const [goneMove] = useState(() => ({
    opacity: gone.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [
      {
        translateY: Animated.multiply(
          gone.interpolate({ inputRange: [0, 1], outputRange: [0, -WORDS_STEP] }),
          wordsWay,
        ),
      },
    ],
  }))

  useEffect(() => {
    if (!song) {
      if (shownId.current === null) return
      shownId.current = null
      session.forget(RISE_KEY)
      setSinking(true)
      timing(rise, 0, motion.base, () => setSinking(false), { easing: ease.in })
      return
    }
    if (shownId.current === null) {
      setSinking(false)
      if (session.first(RISE_KEY))
        timing(rise, 1, MOVE_MS.rise, undefined, { easing: ease.overshoot })
      else rise.setValue(1)
    } else if (shownId.current !== song.id) {
      // The old words step out one way and the new ones step in behind them
      // from the other, a real swap rather than a blank and a fade-in.
      wordsWay.setValue(index < lastIndex.current ? -1 : 1)
      setLeaving(shown)
      gone.setValue(0)
      timing(gone, 1, motion.base, () => setLeaving(null), { easing: ease.in })
      words.setValue(0)
      timing(words, 1, motion.slow, undefined, { easing: ease.out })
    }
    shownId.current = song.id
    lastIndex.current = index
    // `shown` is the previous song on the render this effect answers, which
    // is exactly the one that leaves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, index, rise, words, wordsWay, gone])

  // The card as a whole sinks under a finger (`M1`, 1), to a row's depth:
  // tapping it is how Now Playing opens, and it is the tap made most often.
  const press = usePressScale(PRESS.row)
  const coverRef = useRef<View>(null)
  const open = (): void => {
    // Where the cover is, for Now Playing's cover to grow from (`M2`, 1).
    const node = coverRef.current
    if (!node) {
      router.push('/now-playing')
      return
    }
    node.measureInWindow((x, y, width) => {
      handOffCover({ x, y, size: width })
      router.push('/now-playing')
    })
  }

  const card = song ?? (sinking ? shown : null)
  const songColor = useSongColor(card, card ? artFor(card) : null)
  if (!card) return null

  return (
    <Animated.View
      testID="mini-player"
      style={[
        styles.bar,
        { bottom: navBottom(insets.bottom) + NAV_HEIGHT + MINI_PLAYER_GAP },
        {
          // The overshoot is a curve past 1; the card is never more than opaque.
          opacity: rise.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          }),
          transform: [{ translateY: rise.interpolate(RISE_RANGE) }, ...press.style.transform],
        },
      ]}
      pointerEvents={sinking ? 'none' : 'auto'}
    >
      <View style={styles.clip} pointerEvents="none">
        <MiniProgress color={songColor.color} />
      </View>

      <Pressable
        style={styles.expand}
        onPress={open}
        {...press.handlers}
        accessibilityRole="button"
        accessibilityLabel={`Open now playing: ${card.title}`}
      />

      <View ref={coverRef} collapsable={false}>
        <Cover uri={artFor(card)} title={card.album || card.title} size={44} />
      </View>
      <View style={styles.meta} pointerEvents="none">
        <Animated.View style={wordsMove}>
          <Words song={card} />
        </Animated.View>
        {leaving ? (
          <Animated.View
            style={[styles.wordsGone, goneMove]}
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Words song={leaving} />
          </Animated.View>
        ) : null}
      </View>

      {/* Up next: the sheet over this card and the tab bar (docs/ui-mock `P25`). */}
      <IconButton testID="mini-player-queue" onPress={openQueueSheet} label="Up next">
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
        {/* Waiting on the bucket, the button says so rather than showing a
            pause glyph over silence (`PlayerBar` does the same). */}
        <PlayPauseIcon
          playing={player.isPlaying}
          busy={stalled}
          size={22}
          color={theme.colors.textPrimary}
        />
      </IconButton>
      <IconButton testID="mini-player-next" onPress={player.next} label="Next">
        <Next size={20} color={theme.colors.textSecondary} />
      </IconButton>
    </Animated.View>
  )
}

/** What the session remembers once the card has risen. */
const RISE_KEY = 'mini-player-rise'

/** From under the bar to its place, and five points past it on the way (`M1`). */
const RISE_RANGE = overshootRange(MINI_PLAYER_HEIGHT, 5)

/** How far the words step as one song's give way to the next's. */
const WORDS_STEP = 8

function Words({ song }: { song: Song }): ReactNode {
  return (
    <>
      <Text style={styles.title} numberOfLines={1}>
        {song.title}
      </Text>
      <Text style={styles.artist} numberOfLines={1}>
        {song.artist || 'Unknown artist'}
      </Text>
    </>
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
      line="foot"
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
    overflow: 'hidden',
  },
  // The leaving words, over the arriving ones' place.
  wordsGone: { position: 'absolute', top: 0, left: 0, right: 0, gap: 1 },
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

/**
 * Nothing is passed in — the song, the position and the colour are read
 * from their own stores — so the frame's own renders must not reach it.
 */
export const MiniPlayer = memo(MiniPlayerInner)
