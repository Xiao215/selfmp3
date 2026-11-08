import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { StyleSheet } from 'react-native-unistyles'
import { plural, type MapPlace, type Song } from '@selfmp3/shared'
import { usePlayingSongId } from '../../player/PlayerProvider'
import { lightTap } from '../../ports/haptics'
import { nativeDriver } from '../../ports/nativeDriver'
import type { FieldControl } from './fieldControl'
import {
  announce,
  fieldAccess,
  fieldCursor,
  SPEAKS_CHOICE,
  useFieldFocus,
  useFieldKeys,
  useFieldWheel,
} from './fieldInput'
import {
  actionKey,
  answerKey,
  NO_FIELD_KEYS,
  readingOrder,
  songNearest,
  songToward,
  type FieldKey,
  type FieldKeyEffect,
} from './fieldKeys.model'
import { SkyLayer } from './SkyLayer'
import type { TagRegion } from '@selfmp3/client'
import type { MapTake, SkyPoint } from './sky.model'
import { baseOf, liveView, type FieldSize, type MapView } from './soundMapView.model'

/** How long a finger holds still before a drag draws rather than moves the map. */
const HOLD_MS = 320
/**
 * The ring under a holding finger shows only after this: a finger that is
 * about to move the map rests a moment first, and at 90 ms the ring flashed
 * under nearly every drag before it began (Xiao, 2026-11-01).
 */
const RING_AFTER_MS = 180

/**
 * The sound map's field (docs/features/sound-map.md): the sky, and the
 * gestures over it.
 *
 * One finger moves the map and pinching zooms it, as on any map; a flick
 * carries it on, and a double tap zooms in. A tap plays what is there. Holding still for a moment, then
 * dragging, draws: a ring fills under the finger, a light tap of the phone's
 * engine says drawing has begun. `armed` — the pen, or Shift on a computer —
 * makes the next drag draw at once, and moving takes two fingers meanwhile.
 * On a computer any scroll or pinch zooms, and a drag or the arrow keys move it.
 *
 * Without a pointer (R7G-1): Tab into the field chooses the song nearest the
 * middle, ringed and named; the arrow keys go from song to song, the map
 * following, and Enter or Space plays the one chosen, as a tap there does.
 * Armed, Enter starts a line there instead, which the arrows carry from song
 * to song and Enter ends, as a drawn line is taken. Escape lets go of the
 * song, and then the arrows move the map again. A phone's screen reader steps
 * through the songs with its swipes and plays and draws with its actions
 * (`fieldAccess`); a browser's hears each song from a live region.
 */
export function SoundField({
  control,
  armed,
  points,
  songs,
  regions,
  lens,
  takes,
  stroke,
  lit,
  panel,
  onPress,
  onPathStart,
  onPathMove,
  onPathEnd,
  onPathCancel,
}: {
  control: FieldControl
  armed: boolean
  points: readonly SkyPoint[]
  songs: ReadonlyMap<number, Song>
  regions: readonly TagRegion[]
  lens: number | null
  takes: readonly MapTake[]
  stroke: readonly MapPlace[]
  /** The song the pointer is on in the tray's list, ringed on the map. */
  lit: number | null
  /** How much of the field's right the tray's panel covers. */
  panel: number
  /** A tap, and a finger's reach there: true when it played something, which the pulse marks. */
  onPress: (spot: MapPlace, reach: number) => boolean
  onPathStart: (spot: MapPlace) => void
  /** `exact`: a song the keys went to, kept however near the point before. */
  onPathMove: (spot: MapPlace, reach: number, exact?: boolean) => void
  /** How many songs the stroke took. */
  onPathEnd: () => number
  /** A line drawn with the keys, let go of before it ended. */
  onPathCancel: () => void
}): ReactNode {
  const [field, setField] = useState<FieldSize | null>(null)
  // Where the map is, each frame, for the sky to read without a render: the
  // page is drawn again only when a move settles.
  const [live] = useState(() => liveView({ scale: 1, x: 0, y: 0 }))
  // The view the stars were last drawn for: changes only when a move settles.
  const [settled, setSettled] = useState<MapView | null>(null)
  const [hold, setHold] = useState<{ x: number; y: number } | null>(null)
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => clearTimeout(ringTimer.current ?? undefined), [])
  const fieldRef = useRef<View>(null)
  const playing = usePlayingSongId()
  const [pulse, setPulse] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!pulse) return
    const timer = setTimeout(() => setPulse(null), 600)
    return () => clearTimeout(timer)
  }, [pulse])

  // The page's handlers, newest first, read when the field calls: listening
  // again whenever one changed stopped any flight under way (a listener let
  // go lands it), so the tray opening, or a stroke drawn, left the map where
  // it was instead of sliding the stroke clear (2026-10-26).
  const handlers = useRef({ onPress, onPathStart, onPathMove, onPathEnd, onPathCancel, armed })
  useLayoutEffect(() => {
    handlers.current = { onPress, onPathStart, onPathMove, onPathEnd, onPathCancel, armed }
  })

  // The song the keyboard or a screen reader has chosen, and the line drawn
  // from it, kept in a ref too so keys pressed faster than a render each
  // start from the one before.
  const [keys, setKeys] = useState(NO_FIELD_KEYS)
  const keysRef = useRef(keys)
  const [said, setSaid] = useState('')
  // What the keys did, said: from the live region in a browser, and on a
  // phone (where the song chosen is the field's value) aloud.
  const say = (words: string): void => {
    setSaid(words)
    announce(words)
  }
  const byId = useMemo(() => new Map(points.map(point => [point.id, point])), [points])
  const order = useMemo(() => readingOrder(points), [points])
  const nameOf = (id: number): string => {
    const song = songs.get(id)
    return song ? `${song.title}, ${song.artist}` : ''
  }
  const run = (effect: FieldKeyEffect): void => {
    const place = 'id' in effect ? byId.get(effect.id) : undefined
    const reach = control.reach() ?? 0
    switch (effect.do) {
      case 'choose':
        if (!place) return
        control.keepClear([place])
        setSaid(nameOf(place.id))
        return
      case 'play': {
        const point = place ? control.screenOf(place) : null
        if (place && handlers.current.onPress(place, reach) && point) setPulse(point)
        return
      }
      case 'lineFrom':
        if (!place) return
        handlers.current.onPathStart(place)
        say(`Drawing from ${songs.get(place.id)?.title ?? 'here'}`)
        return
      case 'lineTo':
        if (place) handlers.current.onPathMove(place, reach, true)
        return
      case 'lineEnd': {
        const taken = handlers.current.onPathEnd()
        say(
          taken === 0
            ? 'The line took no songs'
            : `Added ${plural(taken, 'song', 'songs')} to the tray`,
        )
        return
      }
      case 'lineCancel':
        handlers.current.onPathCancel()
        say('Stopped drawing')
        return
      case 'letGo':
        setSaid('')
        return
      case 'zoom': {
        const chosen = keysRef.current.chosen
        control.zoomAbout(chosen === null ? null : (byId.get(chosen) ?? null), effect.factor)
        return
      }
    }
  }
  const press = (key: FieldKey, shift = false): boolean => {
    const answer = answerKey(keysRef.current, key, {
      armed: handlers.current.armed || shift,
      toward: (from, direction) => {
        const spots = control.spotsOf(points)
        const at = spots.find(spot => spot.id === from)
        return at ? songToward(spots, at, direction) : null
      },
      beside: (from, step) => {
        const at = order.indexOf(from)
        return at === -1 ? (order[0] ?? null) : (order[at + step] ?? null)
      },
      middle: () => {
        const middle = control.middle()
        return middle ? songNearest(control.spotsOf(points), middle) : null
      },
    })
    keysRef.current = answer.state
    setKeys(answer.state)
    for (const effect of answer.effects) run(effect)
    return answer.handled
  }
  // A hand on the map lets go of what the keys chose, and of a line they were drawing.
  const letGoKeys = (): void => {
    if (keysRef.current.line !== null) handlers.current.onPathCancel()
    if (keysRef.current === NO_FIELD_KEYS) return
    keysRef.current = NO_FIELD_KEYS
    setKeys(NO_FIELD_KEYS)
    setSaid('')
  }
  const letGo = useRef(letGoKeys)
  useLayoutEffect(() => {
    letGo.current = letGoKeys
  })
  // A song lit from the tray (shown, or under the pointer in its list) is
  // newer than the one the keys chose, which is let go of; a line the keys
  // are drawing is kept.
  useEffect(() => {
    if (lit !== null && keysRef.current.line === null) letGo.current()
  }, [lit])
  useFieldFocus(fieldRef, {
    key: press,
    focus: keyboard => {
      if (keyboard && keysRef.current.chosen === null) press({ key: 'enter' })
    },
    blur: letGoKeys,
  })
  useLayoutEffect(
    () =>
      control.listen({
        show: live.show,
        settle: setSettled,
        press: (spot, point, reach) => {
          letGo.current()
          if (handlers.current.onPress(spot, reach)) setPulse(point)
        },
        // The ring waits for the finger to stay put; one that moves first never sees it.
        hold: point => {
          clearTimeout(ringTimer.current ?? undefined)
          ringTimer.current = null
          if (point) ringTimer.current = setTimeout(() => setHold(point), RING_AFTER_MS)
          else setHold(null)
        },
        pathStart: spot => {
          letGo.current()
          handlers.current.onPathStart(spot)
        },
        pathMove: (spot, reach) => handlers.current.onPathMove(spot, reach),
        pathEnd: () => handlers.current.onPathEnd(),
      }),
    [control, live],
  )

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout
      setField({ width, height })
      control.resize({ width, height })
    },
    [control],
  )
  useFieldWheel(fieldRef, wheel => control.wheel(wheel))
  useFieldKeys(direction => control.keys(direction))

  // Built again only when the pen or Shift changes what a drag does.
  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .maxDistance(10)
      .runOnJS(true)
      .onEnd((event, success) => {
        if (success) control.tap(event.x, event.y)
      })
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDistance(24)
      .maxDelay(260)
      .runOnJS(true)
      .onEnd((event, success) => {
        if (success) control.doubleTap(event.x, event.y)
      })
    // In a browser a released pointer can end a pan as cancelled
    // (QueueSheet.tsx): the stroke is kept either way.
    const draw = Gesture.Pan()
      .maxPointers(1)
      .runOnJS(true)
      .onStart(event => {
        if (!armed) lightTap()
        control.drawStart(event.x, event.y)
      })
      .onUpdate(event => control.drawMove(event.x, event.y))
      .onFinalize(() => {
        control.holdEnd()
        control.drawEnd()
      })
    if (armed) draw.minDistance(2)
    else draw.activateAfterLongPress(HOLD_MS).onBegin(event => control.holdBegin(event.x, event.y))
    const move = Gesture.Pan()
      .minPointers(armed ? 2 : 1)
      .maxPointers(2)
      .minDistance(armed ? 2 : 6)
      .runOnJS(true)
      .onStart(event => control.panStart(event.translationX, event.translationY))
      .onUpdate(event => control.panMove(event.translationX, event.translationY))
      .onEnd(event => control.panEnd(event.velocityX, event.velocityY))
      .onFinalize(() => control.gestureEnd())
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => control.pinchStart())
      .onUpdate(event => control.pinchMove(event.scale, event.focalX, event.focalY))
      .onEnd(() => control.pinchEnd())
    return Gesture.Race(draw, Gesture.Simultaneous(pinch, move), Gesture.Exclusive(doubleTap, tap))
  }, [control, armed])

  return (
    <GestureDetector gesture={gesture}>
      <View
        ref={fieldRef}
        style={[styles.field, fieldCursor(armed)]}
        onLayout={onLayout}
        {...fieldAccess({
          songs: points.length,
          chosen: keys.chosen === null ? null : nameOf(keys.chosen),
          drawing: keys.line !== null,
        })}
        onAccessibilityAction={event => {
          const key = actionKey(event.nativeEvent.actionName)
          if (key) press(key)
        }}
        testID="sound-map-field"
      >
        {field && settled ? (
          <SkyLayer
            field={field}
            live={live}
            settled={settled}
            base={baseOf(field)}
            points={points}
            regions={regions}
            lens={lens}
            takes={takes}
            stroke={stroke}
            playing={playing}
            lit={lit}
            chosen={keys.chosen}
            panel={panel}
            pulse={pulse}
            songs={songs}
            pointerRef={fieldRef}
          />
        ) : null}
        {hold ? <HoldRing at={hold} /> : null}
        {SPEAKS_CHOICE ? (
          <View style={styles.unseen} accessibilityLiveRegion="polite">
            <Text>{said}</Text>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  )
}

const RING = 44

/** The ring that fills under a still finger, until the drag that draws can begin. */
function HoldRing({ at }: { at: { x: number; y: number } }): ReactNode {
  const [grow] = useState(() => new Animated.Value(0))
  useEffect(() => {
    const run = Animated.timing(grow, {
      toValue: 1,
      duration: HOLD_MS - RING_AFTER_MS,
      useNativeDriver: nativeDriver,
    })
    run.start()
    return () => run.stop()
  }, [grow])
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          left: at.x - RING / 2,
          top: at.y - RING / 2,
          opacity: grow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
          transform: [{ scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
        },
      ]}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  field: { flex: 1, overflow: 'hidden', backgroundColor: '#04050b' },
  // Read out, never seen: what the keys chose.
  unseen: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentPill,
  },
}))
