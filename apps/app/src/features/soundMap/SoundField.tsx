import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { StyleSheet } from 'react-native-unistyles'
import type { MapPlace, Song } from '@selfmp3/shared'
import { usePlayingSongId } from '../../player/PlayerProvider'
import { lightTap } from '../../ports/haptics'
import { nativeDriver } from '../../ports/nativeDriver'
import type { FieldControl } from './fieldControl'
import { fieldCursor, useFieldWheel } from './fieldInput'
import { SkyLayer } from './SkyLayer'
import type { TagRegion } from '@selfmp3/client'
import type { MapTake, SkyPoint } from './sky.model'
import { baseOf, type FieldSize, type MapView } from './soundMapView.model'

/** How long a finger holds still before a drag draws rather than moves the map. */
const HOLD_MS = 320
/** The ring under a holding finger shows only after this, so a tap or a move never flickers one. */
const RING_AFTER_MS = 90

/**
 * The sound map's field (docs/features/sound-map.md): the sky, and the
 * gestures over it.
 *
 * One finger moves the map and pinching zooms it, as on any map; a double
 * tap zooms in. A tap plays what is there. Holding still for a moment, then
 * dragging, draws: a ring fills under the finger, a light tap of the phone's
 * engine says drawing has begun. `armed` — the pen, or Shift on a computer —
 * makes the next drag draw at once, and moving takes two fingers meanwhile.
 * A computer's wheel moves it, and a pinch or ⌘-scroll zooms.
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
  onPress,
  onPathStart,
  onPathMove,
  onPathEnd,
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
  /** A tap, and a finger's reach there: true when it played something, which the pulse marks. */
  onPress: (spot: MapPlace, reach: number) => boolean
  onPathStart: (spot: MapPlace) => void
  onPathMove: (spot: MapPlace, reach: number) => void
  onPathEnd: () => void
}): ReactNode {
  const [field, setField] = useState<FieldSize | null>(null)
  const [view, setView] = useState<MapView | null>(null)
  // The view the stars were last drawn for: changes only when a move settles.
  const [settled, setSettled] = useState<MapView | null>(null)
  const [hold, setHold] = useState<{ x: number; y: number } | null>(null)
  const fieldRef = useRef<View>(null)
  const playing = usePlayingSongId()
  const [pulse, setPulse] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!pulse) return
    const timer = setTimeout(() => setPulse(null), 600)
    return () => clearTimeout(timer)
  }, [pulse])

  useLayoutEffect(
    () =>
      control.listen({
        show: setView,
        settle: setSettled,
        press: (spot, point, reach) => {
          if (onPress(spot, reach)) setPulse(point)
        },
        hold: setHold,
        pathStart: onPathStart,
        pathMove: onPathMove,
        pathEnd: onPathEnd,
      }),
    [control, onPress, onPathStart, onPathMove, onPathEnd],
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
      .onFinalize(() => control.gestureEnd())
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => control.pinchStart())
      .onUpdate(event => control.pinchMove(event.scale, event.focalX, event.focalY))
      .onEnd(() => control.gestureEnd())
    return Gesture.Race(draw, Gesture.Simultaneous(pinch, move), Gesture.Exclusive(doubleTap, tap))
  }, [control, armed])

  return (
    <GestureDetector gesture={gesture}>
      <View
        ref={fieldRef}
        style={[styles.field, fieldCursor(armed)]}
        onLayout={onLayout}
        accessibilityLabel={`Sound map, ${points.length} songs. Tap to play the songs there; hold, then drag, to draw a line or a loop.`}
        testID="sound-map-field"
      >
        {field && view && settled ? (
          <SkyLayer
            field={field}
            view={view}
            settled={settled}
            base={baseOf(field)}
            points={points}
            regions={regions}
            lens={lens}
            takes={takes}
            stroke={stroke}
            playing={playing}
            lit={lit}
            pulse={pulse}
            songs={songs}
            pointerRef={fieldRef}
          />
        ) : null}
        {hold ? <HoldRing at={hold} /> : null}
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
      delay: RING_AFTER_MS,
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
          opacity: grow.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 0.6, 1] }),
          transform: [{ scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
        },
      ]}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  field: { flex: 1, overflow: 'hidden', backgroundColor: '#04050b' },
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
