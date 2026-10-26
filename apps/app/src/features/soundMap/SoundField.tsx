import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Image, Text, View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Svg, { Circle, Defs, Polyline, RadialGradient, Stop } from 'react-native-svg'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { hueFromString, type MapPlace, type Song } from '@selfmp3/shared'
import {
  oklchToHex,
  radius,
  space,
  tagColors,
  type,
  type PlacedSong,
  type TagRegion,
} from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayingSongId } from '../../player/PlayerProvider'
import { useShownScheme } from '../../ui/theme/unistyles'
import { IconButton } from '../../ui/components/IconButton'
import { Expand, Minus, Plus } from '../../ui/components/Icons'
import { FieldControl } from './fieldControl'
import { DRAWING_CURSOR, useFieldWheel } from './fieldInput'
import {
  baseOf,
  boundsOf,
  COVER_FROM,
  tileSide,
  toScreen,
  visibleRect,
  type FieldSize,
  type MapView,
} from './soundMapView.model'

/**
 * The sound map's field (docs/features/sound-map.md): every placed song as a
 * small tile, its cover's colour, on the tags' tinted regions. Zoomed in far
 * enough, the tiles on screen show their covers.
 *
 * Press plays what is there; drag draws a path. To move and zoom: two fingers
 * on a phone (pinch, and drag with both), and on a computer scrolling moves it
 * while a trackpad pinch or ⌘-scroll zooms, since a drag is already the path.
 * The +, − and fit buttons do the same for a mouse.
 *
 * The tiles are drawn once into a layer the size of the map at scale 1, which
 * is moved and scaled as a whole while a gesture runs; their sizes and covers
 * are worked out again only when it settles, so 1,500 songs never re-render
 * on every frame.
 */
export function SoundField({
  places,
  songs,
  regions,
  marked,
  path,
  onPress,
  onPathStart,
  onPathMove,
  onPathEnd,
}: {
  places: readonly PlacedSong[]
  songs: ReadonlyMap<number, Song>
  regions: readonly TagRegion[]
  /** Songs to ring: those the drawn path takes. */
  marked: readonly number[]
  path: readonly MapPlace[]
  onPress: (spot: MapPlace) => void
  onPathStart: (spot: MapPlace) => void
  onPathMove: (spot: MapPlace, reach: number) => void
  onPathEnd: () => void
}): ReactNode {
  const [field, setField] = useState<FieldSize | null>(null)
  const [view, setView] = useState<MapView | null>(null)
  // The view the tiles were last sized for: changes only when a move settles.
  const [settled, setSettled] = useState<MapView | null>(null)
  const [control] = useState(() => new FieldControl())
  const fieldRef = useRef<View>(null)
  const [pulse, setPulse] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!pulse) return
    const timer = setTimeout(() => setPulse(null), 700)
    return () => clearTimeout(timer)
  }, [pulse])

  useLayoutEffect(
    () =>
      control.listen({
        show: setView,
        settle: setSettled,
        press: (spot, point) => {
          setPulse(point)
          onPress(spot)
        },
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

  const base = field ? baseOf(field) : 1
  const bounds = useMemo(() => boundsOf(places), [places])
  useLayoutEffect(() => control.setBounds(bounds), [control, bounds])
  useFieldWheel(fieldRef, wheel => control.wheel(wheel))

  // Built once: every handler goes through `control`, which holds the view.
  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .maxDistance(10)
      .runOnJS(true)
      .onEnd((event, success) => {
        if (success) control.tap(event.x, event.y)
      })
    // In a browser a released pointer can end a pan as cancelled
    // (QueueSheet.tsx): the path is kept either way.
    const draw = Gesture.Pan()
      .maxPointers(1)
      .minDistance(8)
      .runOnJS(true)
      .onStart(event => control.drawStart(event.x, event.y))
      .onUpdate(event => control.drawMove(event.x, event.y))
      .onFinalize(() => control.drawEnd())
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => control.pinchStart())
      .onUpdate(event => control.pinchMove(event.scale, event.focalX, event.focalY))
      .onEnd(() => control.gestureEnd())
    const move = Gesture.Pan()
      .minPointers(2)
      .runOnJS(true)
      .onStart(event => control.panStart(event.translationX, event.translationY))
      .onUpdate(event => control.panMove(event.translationX, event.translationY))
      .onFinalize(() => control.gestureEnd())
    return Gesture.Race(Gesture.Simultaneous(pinch, move), draw, tap)
  }, [control])

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={gesture}>
        <View
          ref={fieldRef}
          style={[styles.field, DRAWING_CURSOR]}
          onLayout={onLayout}
          accessibilityLabel={`Sound map, ${places.length} songs. Press to play the songs there, drag to line up a drift.`}
          testID="sound-map-field"
        >
          {field && view && settled ? (
            <>
              <Regions regions={regions} view={view} base={base} field={field} />
              <View
                pointerEvents="none"
                style={[
                  styles.layer,
                  { width: field.width, height: field.height },
                  sinceSettled(view, settled),
                ]}
              >
                <Tiles places={places} songs={songs} base={base} settled={settled} field={field} />
              </View>
              <Overlay
                places={places}
                regions={regions}
                marked={marked}
                path={path}
                view={view}
                base={base}
                field={field}
                pulse={pulse}
              />
            </>
          ) : null}
        </View>
      </GestureDetector>
      <View style={styles.zoom}>
        <IconButton
          label="Zoom in"
          filled
          onPress={() => control.zoomBy(1.6)}
          testID="sound-map-zoom-in"
        >
          <Plus tone="textPrimary" />
        </IconButton>
        <IconButton
          label="Zoom out"
          filled
          onPress={() => control.zoomBy(1 / 1.6)}
          testID="sound-map-zoom-out"
        >
          <Minus tone="textPrimary" />
        </IconButton>
        <IconButton label="Show all" filled onPress={() => control.fit()} testID="sound-map-fit">
          <Expand tone="textPrimary" />
        </IconButton>
      </View>
    </View>
  )
}

/**
 * How far the map has moved since the tiles were drawn: they are drawn at
 * their true size where the settled view put them, and a gesture in progress
 * moves and scales that drawing as a whole until it settles again.
 */
function sinceSettled(view: MapView, settled: MapView) {
  const ratio = view.scale / settled.scale
  return {
    transform: [
      { translateX: view.x - settled.x * ratio },
      { translateY: view.y - settled.y * ratio },
      { scale: ratio },
    ],
    transformOrigin: 'top left',
  }
}

/** The tags' regions, under the tiles: a soft round of each tag's colour where its songs gather. */
function Regions({
  regions,
  view,
  base,
  field,
}: {
  regions: readonly TagRegion[]
  view: MapView
  base: number
  field: FieldSize
}): ReactNode {
  const scheme = useShownScheme()
  return (
    <Svg
      width={field.width}
      height={field.height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Defs>
        {regions.map(region => (
          <RadialGradient
            key={region.tagId}
            id={`region-${region.tagId}`}
            cx="50%"
            cy="50%"
            r="50%"
          >
            <Stop offset="0" stopColor={tagColors(region.hue, scheme).dot} stopOpacity={0.32} />
            <Stop offset="1" stopColor={tagColors(region.hue, scheme).dot} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {regions.map(region => {
        const at = toScreen(view, base, region)
        return (
          <Circle
            key={region.tagId}
            cx={at.x}
            cy={at.y}
            r={region.r * base * view.scale * 1.4}
            fill={`url(#region-${region.tagId})`}
          />
        )
      })}
    </Svg>
  )
}

/** A song's tile colour: its cover's own, or the letter tile's for a song without one. */
function tileColor(song: Song | undefined, scheme: ReturnType<typeof useShownScheme>): string {
  const swatch = song?.coverTone?.palette[0]
  if (swatch) return oklchToHex(swatch.l, swatch.c, swatch.h)
  return tagColors(hueFromString(song?.title ?? ''), scheme).tile
}

/**
 * Every song's tile, at its true size where the settled view puts it. Zoomed
 * in, tiles more than a screen away are left out. Only those on screen, and
 * only once tiles are big enough to show one, ask for their covers: the whole
 * library at once would be 1,500 pictures fetched to be drawn eight points wide.
 */
const Tiles = memo(function Tiles({
  places,
  songs,
  base,
  settled,
  field,
}: {
  places: readonly PlacedSong[]
  songs: ReadonlyMap<number, Song>
  base: number
  settled: MapView
  field: FieldSize
}): ReactNode {
  const scheme = useShownScheme()
  const art = useArt(128)
  const side = tileSide(settled.scale)
  const covers = side >= COVER_FROM
  const seen = visibleRect(settled, base, field)
  // A screen's width and height either side: what a move can bring in before it settles.
  const spanX = seen.x1 - seen.x0
  const spanY = seen.y1 - seen.y0
  const within = (place: MapPlace, margin: number): boolean =>
    place.x >= seen.x0 - spanX * margin &&
    place.x <= seen.x1 + spanX * margin &&
    place.y >= seen.y0 - spanY * margin &&
    place.y <= seen.y1 + spanY * margin
  return (
    <>
      {places.map(place => {
        if (!within(place, 1)) return null
        const song = songs.get(place.id)
        const uri = covers && song && within(place, 0) ? art(song) : null
        const at = toScreen(settled, base, place)
        return (
          <View
            key={place.id}
            style={[
              styles.tile,
              {
                left: at.x - side / 2,
                top: at.y - side / 2,
                width: side,
                height: side,
                borderRadius: side * 0.18,
                backgroundColor: tileColor(song, scheme),
              },
            ]}
          >
            {uri ? <Image source={{ uri }} style={styles.cover} /> : null}
          </View>
        )
      })}
    </>
  )
})

/**
 * What is drawn at screen size over the map: the regions' names, the path
 * being drawn, rings on the songs it takes and on the song playing, and the
 * pulse where the map was pressed.
 */
function Overlay({
  places,
  regions,
  marked,
  path,
  view,
  base,
  field,
  pulse,
}: {
  places: readonly PlacedSong[]
  regions: readonly TagRegion[]
  marked: readonly number[]
  path: readonly MapPlace[]
  view: MapView
  base: number
  field: FieldSize
  pulse: { x: number; y: number } | null
}): ReactNode {
  const { theme } = useUnistyles()
  const scheme = useShownScheme()
  const playing = usePlayingSongId()
  const byId = useMemo(() => new Map(places.map(place => [place.id, place])), [places])
  const side = tileSide(view.scale)
  const ring = (id: number, color: string, width: number, key: string): ReactNode => {
    const place = byId.get(id)
    if (!place) return null
    const at = toScreen(view, base, place)
    return (
      <Circle
        key={key}
        cx={at.x}
        cy={at.y}
        r={side * 0.75 + 2}
        stroke={color}
        strokeWidth={width}
        fill="none"
      />
    )
  }
  const points = path.map(spot => toScreen(view, base, spot))
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={field.width} height={field.height} style={StyleSheet.absoluteFill}>
        {marked.map(id => ring(id, theme.colors.accent, 1.5, `m${id}`))}
        {points.length > 1 ? (
          <Polyline
            points={points.map(point => `${point.x},${point.y}`).join(' ')}
            stroke={theme.colors.accent}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2 7"
            fill="none"
          />
        ) : null}
        {points.length > 0 ? (
          <>
            <Circle cx={points[0]!.x} cy={points[0]!.y} r={5} fill={theme.colors.accent} />
            <Circle
              cx={points[points.length - 1]!.x}
              cy={points[points.length - 1]!.y}
              r={5}
              fill={theme.colors.accent}
            />
          </>
        ) : null}
        {playing !== null ? ring(playing, theme.colors.textPrimary, 2, 'playing') : null}
        {pulse ? <Circle cx={pulse.x} cy={pulse.y} r={14} fill={theme.colors.accentPill} /> : null}
      </Svg>
      {regions.map(region => {
        const at = toScreen(view, base, region)
        return (
          <Text
            key={region.tagId}
            numberOfLines={1}
            style={[
              styles.regionName,
              {
                left: at.x - 60,
                top: at.y - region.r * base * view.scale - 8,
                color: tagColors(region.hue, scheme).ink,
              },
            ]}
          >
            {region.name}
          </Text>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  wrap: { flex: 1 },
  field: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface1,
    borderRadius: radius.card,
  },
  layer: { position: 'absolute', left: 0, top: 0 },
  tile: { position: 'absolute', overflow: 'hidden' },
  cover: { width: '100%', height: '100%' },
  regionName: {
    position: 'absolute',
    width: 120,
    textAlign: 'center',
    fontSize: type.small,
    fontWeight: '600',
  },
  zoom: {
    position: 'absolute',
    right: space.md,
    bottom: space.md,
    gap: space.sm,
  },
}))
