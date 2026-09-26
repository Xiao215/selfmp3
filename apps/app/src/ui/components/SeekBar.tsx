import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, PanResponder, Text, View, type LayoutChangeEvent } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { formatDuration } from '@selfmp3/shared'
import type { LoopRegion } from '@selfmp3/client'
import { useAccent } from '../accent'
import { space, type, withAlpha } from '@selfmp3/client'
import { spring } from '../motion'
import { SEEK_STEP_SECONDS } from '../../player/progress.model'

/**
 * Closer than this to a seek, the player is taken to be there. Wide enough for
 * a second of play at twice the speed, so a seek that landed is not pulled back.
 */
const SEEK_LANDED_SECONDS = 2.1
/** How long a let-go position is held against an engine still reporting the old one. */
const SEEK_SETTLE_MS = 1000
/** What a screen reader can do to an adjustable: the same pair its sibling `Slider` offers. */
const ADJUST_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }] as const

/**
 * Scrubber: a 6px track with a 16px thumb that is always there, in a hit area
 * big enough to grab while walking.
 *
 * Hand-built on PanResponder rather than a slider package: it is thirty lines,
 * it avoids a dependency, and it lets the bar keep showing the dragged
 * position while the finger is down instead of fighting the player's own
 * progress updates.
 *
 * The responder is rebuilt when the width or the track changes rather than
 * reading refs — PanResponder objects are cheap, and the alternative is a
 * handler that quietly seeks using the previous track's duration.
 */
export function SeekBar({
  position,
  duration,
  onSeek,
  inline = false,
  loop = null,
  color,
}: {
  position: number
  duration: number
  onSeek: (seconds: number) => void
  /**
   * The player bar's scrubber: elapsed, a thin track, and the length on
   * one line, rather than the Now Playing page's thick track with the times
   * beneath it.
   */
  inline?: boolean
  /** The practice loop, as percentages of the bar, drawn behind the track. */
  loop?: LoopRegion | null
  /** The playing song's colour, for the played part and the loop. The accent when not given. */
  color?: string
}): ReactNode {
  const accent = useAccent()
  const fill = color ?? accent.accent
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState<number | null>(null)
  /**
   * Where the finger let go, until the player says it is there. A phone's
   * engine reports the pre-seek time for a tick or two, and without this the
   * thumb jumps back to it and forward again.
   */
  const [pending, setPending] = useState<number | null>(null)
  // Held only while the player is still somewhere else: once it reports the
  // new time, the bar follows it again.
  const held =
    pending !== null && Math.abs(position - pending) >= SEEK_LANDED_SECONDS ? pending : null
  /*
   * The hold lets go on its own, a second after the finger did. The timer is
   * the effect's rather than the gesture's so that it goes when the bar does:
   * a scrubbed song closed before it woke had it setting state on a bar that
   * is no longer there.
   */
  useEffect(() => {
    if (pending === null) return undefined
    const timer = setTimeout(
      // This seek only: a later one, made meanwhile, starts its own hold.
      () => setPending(current => (current === pending ? null : current)),
      SEEK_SETTLE_MS,
    )
    return () => clearTimeout(timer)
  }, [pending])

  const responder = useMemo(() => {
    // locationX is relative to the view the finger is on. On iOS that is the
    // innermost one, so the track, fill and thumb take no touches: a drag that
    // began on the thumb read positions from the thumb's own edge, and the thumb
    // flickered between two places as it moved. With them out of the way it is
    // always the bar, and stays correct as the bar moves around the screen.
    const secondsAt = (x: number): number => {
      if (width <= 0 || duration <= 0) return 0
      return Math.max(0, Math.min(1, x / width)) * duration
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // A scrub that wanders downward is still a scrub, not the page's swipe to close.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: event => setDragging(secondsAt(event.nativeEvent.locationX)),
      onPanResponderMove: event => setDragging(secondsAt(event.nativeEvent.locationX)),
      onPanResponderRelease: event => {
        const target = secondsAt(event.nativeEvent.locationX)
        setPending(target)
        setDragging(null)
        onSeek(target)
      },
      onPanResponderTerminate: () => setDragging(null),
    })
  }, [width, duration, onSeek])

  const shown = dragging ?? held ?? position
  const ratio = duration > 0 ? Math.max(0, Math.min(1, shown / duration)) : 0
  /*
   * How far along, rounded to a tenth of a per cent. `ProgressWash.tsx` (45-59)
   * explains this at length and the reason is the same one: on the web every
   * distinct value written into a style becomes its own atomic CSS rule, and an
   * unrounded width from a position that ticks several times a second is a new
   * rule every tick, for the length of every song. A tenth still moves the fill
   * about a point and a half a tick — as often as the thumb itself moves, so
   * nothing looks like it is lagging its song — and there are only a thousand
   * such values, reused by every song, so the sheet stops growing.
   */
  const tenths = Math.round(ratio * 1000)
  const at = tenths / 1000
  /** The fill as a share of the track, so the rounded values repeat whatever the width. */
  const fillWidth = `${tenths / 10}%` as const

  /*
   * The thumb swells under the finger. On the spring, as every press in the app
   * is (`M1`, "Press"): it was a style flip from 1 to 1.2 and back, the one
   * control in the app that jumped where everything around it sinks.
   */
  const grabbing = dragging !== null
  const [grabbed] = useState(() => new Animated.Value(1))
  useEffect(() => {
    spring(grabbed, grabbing ? THUMB_GRABBED : 1)
  }, [grabbing, grabbed])
  const [thumbScale] = useState(() => ({ transform: [{ scale: grabbed }] }))

  /** A screen reader's swipe up or down: a step along, as the keyboard seeks. */
  const onAccessibilityAction = (event: { nativeEvent: { actionName: string } }): void => {
    const step =
      event.nativeEvent.actionName === 'increment' ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS
    const target = Math.max(0, Math.min(duration, shown + step))
    setPending(target)
    onSeek(target)
  }

  const onLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width)
  }

  if (inline) {
    return (
      <View style={styles.inline}>
        <Text style={styles.timeInline}>{formatDuration(shown)}</Text>
        <View style={styles.inlineTrack}>
          <View
            style={[styles.hit, inline && styles.hitInline]}
            onLayout={onLayout}
            accessibilityRole="adjustable"
            accessibilityLabel="Seek"
            accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown) }}
            /*
             * The same numbers again as ARIA props: `react-native-web` renders
             * `accessibilityRole="adjustable"` as `role="slider"` and then drops
             * `accessibilityValue`, leaving a slider that announces no position.
             * React Native maps these to the same place, so it is the one
             * spelling that works on both.
             */
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(shown)}
            accessibilityActions={ADJUST_ACTIONS}
            onAccessibilityAction={onAccessibilityAction}
            {...responder.panHandlers}
          >
            {loop ? (
              <View
                pointerEvents="none"
                style={[
                  styles.loop,
                  inline && styles.loopInline,
                  {
                    left: `${loop.left}%`,
                    width: `${loop.width}%`,
                    borderColor: fill,
                    backgroundColor: withAlpha(fill, 0.16),
                  },
                ]}
              />
            ) : null}
            {/* Draws only: a touch on the thumb must reach the bar, see the responder. */}
            <View pointerEvents="none" style={[styles.track, inline && styles.trackInline]}>
              <View
                style={[
                  styles.fill,
                  inline && styles.fillInline,
                  { width: fillWidth, backgroundColor: fill },
                ]}
              />
              <Animated.View
                style={[
                  styles.thumb,
                  inline && styles.thumbInline,
                  { left: Math.max(0, width * at - (inline ? THUMB_INLINE : THUMB) / 2) },
                  thumbScale,
                ]}
              />
            </View>
          </View>
        </View>
        <Text style={styles.timeInline}>{formatDuration(duration)}</Text>
      </View>
    )
  }

  return (
    <View style={styles.wrapper}>
      <View
        style={styles.hit}
        onLayout={onLayout}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown) }}
        /*
         * The same numbers again as ARIA props: `react-native-web` renders
         * `accessibilityRole="adjustable"` as `role="slider"` and then drops
         * `accessibilityValue`, leaving a slider that announces no position.
         * React Native maps these to the same place, so it is the one
         * spelling that works on both.
         */
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        accessibilityActions={ADJUST_ACTIONS}
        onAccessibilityAction={onAccessibilityAction}
        {...responder.panHandlers}
      >
        {loop ? (
          <View
            pointerEvents="none"
            style={[
              styles.loop,
              {
                left: `${loop.left}%`,
                width: `${loop.width}%`,
                borderColor: fill,
                backgroundColor: withAlpha(fill, 0.16),
              },
            ]}
          />
        ) : null}
        {/* Draws only: a touch on the thumb must reach the bar, see the responder. */}
        <View pointerEvents="none" style={styles.track}>
          <View style={[styles.fill, { width: fillWidth, backgroundColor: fill }]} />
          <Animated.View
            style={[styles.thumb, { left: Math.max(0, width * at - THUMB / 2) }, thumbScale]}
          />
        </View>
      </View>
      {/* Elapsed on the left, what is left on the right. */}
      <View style={styles.times}>
        <Text style={styles.time}>{formatDuration(shown)}</Text>
        <Text style={styles.time}>-{formatDuration(Math.max(0, duration - shown))}</Text>
      </View>
    </View>
  )
}

const THUMB = 16
const THUMB_INLINE = 12
/** How far the thumb swells while it is held. */
const THUMB_GRABBED = 1.2

const styles = StyleSheet.create(theme => ({
  /* `.player-progress`: the times either side, 11-point and tabular. */
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  inlineTrack: { flex: 1, minWidth: 0 },
  /* In the title's colour: muted, the times all but disappeared over a song-coloured page. */
  timeInline: {
    color: theme.colors.textPrimary,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    minWidth: 36,
    textAlign: 'center',
  },
  hitInline: { paddingVertical: 8 },
  trackInline: { height: 4, borderRadius: 2 },
  fillInline: { height: 4, borderRadius: 2 },
  thumbInline: { width: THUMB_INLINE, height: THUMB_INLINE, borderRadius: THUMB_INLINE / 2 },
  /* `.loop-region`: low-contrast, a little taller than the track. Its two edges are
     the loop's ends, the mark itself, so they stay. */
  loop: {
    position: 'absolute',
    top: '50%',
    height: 14,
    marginTop: -7,
    minWidth: 2,
    borderRadius: 2,
    borderLeftWidth: 2,
    borderRightWidth: 2,
  },
  loopInline: { height: 10, marginTop: -5 },
  wrapper: {
    width: '100%',
  },
  hit: {
    paddingVertical: space.md,
    justifyContent: 'center',
    // A pointing hand where there is a mouse: the bar is a control, not a
    // picture. React Native types `cursor` as `auto | pointer`, so this needs
    // no port — only `grab`/`grabbing` do (`ports/dragCursor`).
    cursor: 'pointer',
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface3,
    justifyContent: 'center',
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: theme.colors.textPrimary,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  time: {
    color: theme.colors.textPrimary,
    fontSize: type.tiny,
    fontVariant: ['tabular-nums'],
  },
}))
