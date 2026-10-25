import { memo, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { artistOr } from '@selfmp3/shared'
import { usePlayer } from '../../player/PlayerProvider'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useSongColor } from '../useSongColor'
import {
  MINI_PLAYER_HEIGHT,
  motion,
  NAV_HEIGHT,
  radius,
  space,
  type,
  iconSize,
} from '@selfmp3/client'
import { MINI_PLAYER_GAP, navBottom, useFloatingBarSide } from '../../shell/bottomInset'
import { useLayoutValue } from '../../shell/useLayout'
import { openQueueSheet } from '../../features/queue/queueSheet.store'
import { Cover } from './Cover'
import { UpNextTarget } from './CoverFlight'
import { IconButton } from './IconButton'
import { ProgressWash } from './ProgressWash'
import { Next, UpNext } from './Icons'
import { floating, rowTitle } from '../surfaces'
import { PlayPauseButton } from './PlayPauseButton'
import { useOpenNowPlaying } from '../useOpenNowPlaying'
import { ease, session, timing, usePressScale } from '../motion'
import { MOVE_MS, overshootRange, PRESS } from '../motion.model'
import { CONTROL_SCALE } from '../textScale'

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
  // On a 320 pt phone three 44 pt buttons left the song's name 84 pt: drawn
  // at 36 there, each still answers a finger over 44 (P13 B).
  const button = useLayoutValue(layout => (layout.width < NARROW_PHONE ? NARROW_BUTTON : undefined))
  const side = useFloatingBarSide(EDGE)
  const song = player.current
  const insets = useSafeAreaInsets()

  // The first song of a session: the card rises from under the tab bar and
  // runs a few points past its place before settling (`M1`, 3). After that the
  // card is simply there — coming back from Now Playing remounts it, and it
  // should not arrive twice. When the queue empties the card sinks back under
  // the bar the way it came, quicker, and only then goes; the last song is
  // kept drawn on it for the way down. The next song is a new arrival.
  const [rise] = useState(() => new Animated.Value(song && session.seen(RISE_KEY) ? 1 : 0))
  const [shown, setShown] = useState<Song | null>(song)
  if (song && song !== shown) setShown(song)
  // The song the effect below last answered for: the one whose words leave as
  // the next song's arrive. Not `shown`, which is already the new song by the
  // time the effect runs.
  const last = useRef<Song | null>(null)
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
      if (last.current === null) return
      last.current = null
      session.forget(RISE_KEY)
      timing(rise, 0, motion.base, () => setShown(null), { easing: ease.in })
      return
    }
    if (last.current === null) {
      if (session.first(RISE_KEY))
        timing(rise, 1, MOVE_MS.rise, undefined, { easing: ease.overshoot })
      else rise.setValue(1)
    } else if (last.current.id !== song.id) {
      // The old words step out one way and the new ones step in behind them
      // from the other, a real swap rather than a blank and a fade-in.
      wordsWay.setValue(index < lastIndex.current ? -1 : 1)
      setLeaving(last.current)
      gone.setValue(0)
      timing(gone, 1, motion.base, () => setLeaving(null), { easing: ease.in })
      words.setValue(0)
      timing(words, 1, motion.slow, undefined, { easing: ease.out })
    }
    last.current = song
    lastIndex.current = index
  }, [song, index, rise, words, wordsWay, gone])

  // The card as a whole sinks under a finger (`M1`, 1), to a row's depth:
  // tapping it is how Now Playing opens, and it is the tap made most often.
  const press = usePressScale(PRESS.row)
  // The rise and the press on one transform, built once: the card re-renders
  // with the player, and an interpolation made in the render is a new node
  // for the native driver every time.
  const [arrival] = useState(() => ({
    // The overshoot is a curve past 1; the card is never more than opaque.
    opacity: rise.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: rise.interpolate(RISE_RANGE) }, ...press.style.transform],
  }))
  // Where the cover is, for Now Playing's cover to grow from (`M2`, 1).
  const { coverRef, open } = useOpenNowPlaying()

  // With the queue emptied, the last song stays drawn until the card has sunk.
  const card = song ?? shown
  const songColor = useSongColor(card, card ? artFor(card) : null)
  if (!card) return null

  return (
    <Animated.View
      testID="mini-player"
      style={[
        styles.bar,
        {
          bottom: navBottom(insets.bottom) + NAV_HEIGHT + MINI_PLAYER_GAP,
          left: side,
          right: side,
        },
        arrival,
      ]}
      pointerEvents={song ? 'auto' : 'none'}
    >
      <View style={styles.clip} pointerEvents="none">
        <ProgressWash color={songColor.color} fade={24} line="foot" />
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
      <UpNextTarget>
        <IconButton
          testID="mini-player-queue"
          onPress={openQueueSheet}
          label="Up next"
          size={button}
        >
          <UpNext size={iconSize.nav} color={theme.colors.textSecondary} />
        </IconButton>
      </UpNextTarget>
      {/*
        The transport carries whether it is playing in its own testID, rather
        than a separate marker element. A marker with nothing in it has no size,
        and a flow does not count a zero-by-zero view as visible.
      */}
      <PlayPauseButton
        bare
        size={button}
        glyph={iconSize.large}
        testID={playing => (playing ? 'mini-player-playing' : 'mini-player-paused')}
      />
      <IconButton testID="mini-player-next" onPress={player.next} label="Next" size={button}>
        <Next size={iconSize.nav} color={theme.colors.textSecondary} />
      </IconButton>
    </Animated.View>
  )
}

/** Under this width the card's buttons are drawn smaller, and the button they draw. */
const NARROW_PHONE = 360
const NARROW_BUTTON = 36

/** What the session remembers once the card has risen. */
const RISE_KEY = 'mini-player-rise'

/** From under the bar to its place, and five points past it on the way (`M1`). */
const RISE_RANGE = overshootRange(MINI_PLAYER_HEIGHT, 5)

/** Room from each edge of the display (the tab bar under it keeps 16). */
const EDGE = space.md

/** How far the words step as one song's give way to the next's. */
const WORDS_STEP = 8

function Words({ song }: { song: Song }): ReactNode {
  return (
    <>
      {/* The card is a control of a set height: its words stop at the controls' size. */}
      <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={CONTROL_SCALE}>
        {song.title}
      </Text>
      <Text style={styles.artist} numberOfLines={1} maxFontSizeMultiplier={CONTROL_SCALE}>
        {artistOr(song.artist)}
      </Text>
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  bar: {
    position: 'absolute',
    left: EDGE,
    right: EDGE,
    height: MINI_PLAYER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingLeft: space.sm,
    paddingRight: space.xs,
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
    marginLeft: space.sm,
    gap: 1,
    overflow: 'hidden',
  },
  // The leaving words, over the arriving ones' place.
  wordsGone: { position: 'absolute', top: 0, left: 0, right: 0, gap: 1 },
  title: rowTitle(theme.colors),
  artist: {
    color: theme.colors.textSecondary,
    fontSize: type.small,
  },
}))

/**
 * Nothing is passed in — the song, the position and the colour are read
 * from their own stores — so the frame's own renders must not reach it.
 */
export const MiniPlayer = memo(MiniPlayerInner)
