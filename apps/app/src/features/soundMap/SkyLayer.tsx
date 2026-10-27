import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Animated, Easing, Image, Text, View } from 'react-native'
import Reanimated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { useFocusEffect } from 'expo-router'
import type { View as ViewType } from 'react-native'
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  Path,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { MapPlace, Song } from '@selfmp3/shared'
import { tagColors, type } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { MOVE_MS } from '../../ui/motion.model'
import { nativeDriver, useMotionReduced } from '../../ui/motion'
import {
  CORE,
  DEEP_BEATS_MS,
  DEEP_LAYERS,
  deepPlaces,
  deepSince,
  deepStars,
  dustSpecks,
  flareReach,
  glint,
  glowReach,
  GLOW_STOPS,
  haloReach,
  ringRadius,
  SKY_EDGE,
  SKY_INK,
  SKY_TOP,
  starAlpha,
  starLook,
  TWINKLE_LOW,
  type DeepStar,
  type SkyLayerProps,
  type SkyPoint,
} from './sky.model'
import {
  tileSide,
  toScreen,
  visibleRect,
  type FieldSize,
  type LiveView,
  type MapView,
} from './soundMapView.model'

/** Covers this wide wear their titles underneath. */
const NAMES_FROM = 30

/**
 * The sound map's sky on a phone or an iPad (`SkyLayer.web.tsx` is the
 * browser's). Everything a song is drawn with — the nebulae, the stars, the
 * covers, what the tray holds, the song playing — is drawn once for the view
 * the map last held still at, into a layer kept as one picture
 * (`shouldRasterizeIOS`), and a move only moves and scales that picture on the
 * native side (`useLiveView`): nothing is drawn again, and React does nothing,
 * until the map settles. Each star is a dot over a glow that keeps to the room
 * its neighbours leave, and the stars of one colour share one gradient. Close
 * in, each opens into its cover, the most played first (`starLook`). Behind
 * them the deep sky twinkles (`DeepSky`).
 *
 * The sky is drawn twice over (`useSlots`): when the map settles, the copy
 * not showing is drawn for the new view, and once that is on screen the
 * native side shows it, moved for where the map is, and hides the other in
 * the same frame, so the sky never shows a frame of new stars at the old
 * place, nor the old at the new.
 *
 * 2026-10-26: the map drew its nebulae and the tray's marks again every frame
 * of a move, through React, and composited every open cover's rounded clip
 * every frame; with covers up a pan ran at about 10 frames a second on the
 * simulator and trailed the finger by seconds.
 */
export function SkyLayer(
  props: SkyLayerProps & { pointerRef: RefObject<ViewType | null> },
): ReactNode {
  const { field, settled } = props
  const view = useLiveView(props.live)
  const { slots, front, shown } = useSlots(settled)
  const { litOpen } = useMarked(props)
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Ground field={field} />
      {props.still ? null : <DeepSky field={field} view={view} slots={slots} shown={shown} />}
      {slots.map((drawn, slot) =>
        drawn ? (
          <Slot key={slot} slot={slot} view={view} shown={shown} field={field}>
            <Sky
              field={field}
              settled={drawn}
              base={props.base}
              points={props.points}
              songs={props.songs}
              regions={props.regions}
              lens={props.lens}
              takes={props.takes}
              playing={props.playing}
              lit={props.lit}
            />
          </Slot>
        ) : null,
      )}
      {litOpen ? <View pointerEvents="none" style={styles.spotVeil} /> : null}
      <Slot slot={front} view={view} shown={shown} field={field}>
        <Over {...props} />
      </Slot>
    </View>
  )
}

/** Which copy of the sky is on screen, and the view it was drawn for. */
interface Shown {
  readonly slot: number
  readonly view: MapView
}

/**
 * The two copies of the sky and the view each was last drawn for. A settled
 * view is drawn into the copy not showing (`front` becomes it); after the
 * commit that drew it, `shown` names it, and the native side swaps.
 */
function useSlots(settled: MapView): {
  slots: readonly (MapView | null)[]
  front: number
  shown: SharedValue<Shown>
} {
  const [state, setState] = useState({
    slots: [settled, null] as readonly (MapView | null)[],
    front: 0,
    last: settled,
  })
  let now = state
  if (state.last !== settled) {
    const back = 1 - state.front
    now = {
      slots: state.slots.map((drawn, slot) => (slot === back ? settled : drawn)),
      front: back,
      last: settled,
    }
    setState(now)
  }
  const shown = useSharedValue<Shown>({ slot: now.front, view: now.last })
  const { front, last } = now
  useLayoutEffect(() => {
    shown.value = { slot: front, view: last }
  }, [front, last, shown])
  return { slots: now.slots, front, shown }
}

/**
 * One copy of the sky: shown while `shown` names it, moved and scaled from
 * the view it was drawn for to where the map is.
 */
function Slot({
  slot,
  view,
  shown,
  field,
  children,
}: {
  slot: number
  view: SharedValue<MapView>
  shown: SharedValue<Shown>
  field: FieldSize
  children: ReactNode
}): ReactNode {
  const moving = useAnimatedStyle(() => {
    const on = shown.value.slot === slot
    return {
      opacity: on ? 1 : 0,
      transform: sinceSettled(view.value, shown.value.view, field),
    }
  })
  return (
    <Reanimated.View style={[LAYER, { width: field.width, height: field.height }, moving]}>
      {children}
    </Reanimated.View>
  )
}

/**
 * Everything a song is drawn with, for one settled view, kept as one picture
 * while the map moves (`shouldRasterizeIOS`): moving it composites that
 * picture rather than every glow, cover and rim again.
 */
const Sky = memo(function Sky({
  field,
  settled,
  base,
  points,
  songs,
  regions,
  lens,
  takes,
  playing,
  lit,
}: Pick<
  SkyLayerProps,
  | 'field'
  | 'settled'
  | 'base'
  | 'points'
  | 'songs'
  | 'regions'
  | 'lens'
  | 'takes'
  | 'playing'
  | 'lit'
>): ReactNode {
  return (
    <View style={[LAYER, { width: field.width, height: field.height }]} shouldRasterizeIOS>
      <Nebulae field={field} settled={settled} base={base} regions={regions} lens={lens} />
      <Stars points={points} settled={settled} base={base} field={field} lens={lens} />
      <Covers
        points={points}
        songs={songs}
        settled={settled}
        base={base}
        field={field}
        lens={lens}
      />
      <Glints points={points} settled={settled} base={base} field={field} lens={lens} />
      <Marks
        field={field}
        settled={settled}
        base={base}
        points={points}
        takes={takes}
        playing={playing}
        lit={lit}
        songs={songs}
      />
    </View>
  )
})

/**
 * A layer the size of the field. Not a themed style: Reanimated flattens an
 * animated view's styles into one, and Unistyles cannot follow its own
 * styles once flattened.
 */
const LAYER = { position: 'absolute', left: 0, top: 0 } as const
/** The field, whole: a deep layer, moved about its middle. */
const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const

/**
 * Where the map is, on the native side: the field's frames go straight to a
 * shared value, which moves the sky without a render.
 */
function useLiveView(live: LiveView): SharedValue<MapView> {
  const view = useSharedValue(live.now())
  useEffect(() => {
    view.value = live.now()
    return live.watch(next => {
      view.value = next
    })
  }, [live, view])
  return view
}

/**
 * How far the map has moved from `from` to `to`: a drawing made for `from`,
 * moved and scaled by this, stands where `to` would draw it. The scale is
 * about the field's middle, as a view's transform is by default, and the
 * move makes up for it, so it does not hang on `transformOrigin`, which
 * Reanimated leaves out when it moves a view without a render.
 */
function sinceSettled(to: MapView, from: MapView, field: FieldSize) {
  'worklet'
  const ratio = to.scale / from.scale
  return [
    { translateX: to.x - from.x * ratio - (field.width / 2) * (1 - ratio) },
    { translateY: to.y - from.y * ratio - (field.height / 2) * (1 - ratio) },
    { scale: ratio },
  ]
}

/** The night ground and its dust, for the field's size. */
const Ground = memo(function Ground({ field }: { field: FieldSize }): ReactNode {
  const specks = useMemo(() => dustSpecks(field, 260), [field])
  return (
    <Svg width={field.width} height={field.height} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="sky-ground" cx="50%" cy="45%" r="80%">
          <Stop offset="0" stopColor={SKY_TOP} />
          <Stop offset="1" stopColor={SKY_EDGE} />
        </RadialGradient>
      </Defs>
      <Rect width={field.width} height={field.height} fill="url(#sky-ground)" />
      {specks.map((speck, index) => (
        <Rect
          key={index}
          x={speck.x}
          y={speck.y}
          width={speck.side}
          height={speck.side}
          fill="#c8d2ff"
          opacity={speck.opacity}
        />
      ))}
    </Svg>
  )
})

/**
 * The deep sky (K3) on a phone: faint stars that are not songs, placed for
 * the view the map last held still at, in each copy of the sky, and moved a
 * part as far as the map does while a finger moves it (`deepSince`). Each
 * follows one of three slow twinkles, run on the native side, so nothing is
 * drawn again while they twinkle. Under Reduce Motion they hold still, and so
 * they do while another page is over the map.
 */
function DeepSky({
  field,
  view,
  slots,
  shown,
}: {
  field: FieldSize
  view: SharedValue<MapView>
  slots: readonly (MapView | null)[]
  shown: SharedValue<Shown>
}): ReactNode {
  const layers = useMemo(() => deepStars(), [])
  const reduced = useMotionReduced()
  const beats = useBeats(useFocused() && !reduced)
  return (
    <View style={StyleSheet.absoluteFill}>
      {slots.map((drawn, slot) =>
        drawn
          ? layers.map((stars, layer) => (
              <DeepDrift
                key={`${slot}-${layer}`}
                slot={slot}
                shown={shown}
                stars={stars}
                parallax={DEEP_LAYERS[layer]!.parallax}
                view={view}
                settled={drawn}
                field={field}
                beats={beats}
              />
            ))
          : null,
      )}
    </View>
  )
}

/**
 * One deep layer in one copy of the sky, moved a part as far as the map is
 * on the native side (`deepSince`).
 */
function DeepDrift({
  slot,
  shown,
  view,
  parallax,
  ...layer
}: {
  slot: number
  shown: SharedValue<Shown>
  stars: readonly DeepStar[]
  parallax: number
  view: SharedValue<MapView>
  settled: MapView
  field: FieldSize
  beats: readonly Animated.Value[] | null
}): ReactNode {
  const drift = useAnimatedStyle(() => {
    const since = deepSince(view.value, shown.value.view, parallax)
    return {
      opacity: shown.value.slot === slot ? 1 : 0,
      transform: [{ translateX: since.x }, { translateY: since.y }, { scale: since.scale }],
    }
  })
  return (
    <Reanimated.View style={[FILL, drift]}>
      <DeepLayer parallax={parallax} {...layer} />
    </Reanimated.View>
  )
}

/**
 * Whether the map's page is the one showing: a page under another stays
 * mounted, and its sky should not twinkle there unseen.
 */
function useFocused(): boolean {
  const [focused, setFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, []),
  )
  return focused
}

/** The three twinkles (`DEEP_BEATS_MS`), each rising and falling for as long as the map is open; none under Reduce Motion. */
function useBeats(twinkle: boolean): readonly Animated.Value[] | null {
  const [beats] = useState(() => DEEP_BEATS_MS.map(() => new Animated.Value(0)))
  useEffect(() => {
    if (!twinkle) return
    const running = beats.map((beat, index) => {
      const half = DEEP_BEATS_MS[index]! / 2
      const stroke = (toValue: number): Animated.CompositeAnimation =>
        Animated.timing(beat, {
          toValue,
          duration: half,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: nativeDriver,
        })
      const loop = Animated.loop(Animated.sequence([stroke(1), stroke(0)]))
      loop.start()
      return loop
    })
    return () => running.forEach(loop => loop.stop())
  }, [beats, twinkle])
  return twinkle ? beats : null
}

/**
 * One layer's stars, drawn for where the map last held still, with a quarter
 * of the field around it. They are grouped by the twinkle they follow, and
 * the group is what twinkles: one star an animated view was 380 views moved
 * every frame, about 40 % of a phone's time on the simulator (2026-10-26).
 * Each group is one drawing, a path a colour and step of brightness, rather
 * than a view a star, so a settle has a few paths to build, not 380 views.
 */
const DeepLayer = memo(function DeepLayer({
  stars,
  parallax,
  settled,
  field,
  beats,
}: {
  stars: readonly DeepStar[]
  parallax: number
  settled: MapView
  field: FieldSize
  beats: readonly Animated.Value[] | null
}): ReactNode {
  const placed = deepPlaces(stars, parallax, settled, field, DEEP_MARGIN)
  const left = field.width * DEEP_MARGIN
  const top = field.height * DEEP_MARGIN
  const width = field.width + left * 2
  const height = field.height + top * 2
  return (
    <>
      {DEEP_BEATS_MS.map((_, beat) => {
        const paths = new Map<string, string[]>()
        for (const { star, x, y, size } of placed) {
          if (star.beat !== beat) continue
          const key = `${star.tint} ${Math.max(1, Math.round(star.opacity * 20))}`
          const r = size / 2
          const dot = `M${x + left - r},${y + top}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`
          const same = paths.get(key)
          if (same) same.push(dot)
          else paths.set(key, [dot])
        }
        const opacity = beats
          ? beats[beat]!.interpolate({ inputRange: [0, 1], outputRange: [TWINKLE_LOW, 1] })
          : 1
        return (
          <Animated.View
            key={beat}
            style={{ position: 'absolute', left: -left, top: -top, width, height, opacity }}
          >
            <Svg width={width} height={height}>
              {[...paths].map(([key, dots]) => {
                const [tint, twentieths] = key.split(' ')
                return (
                  <Path
                    key={key}
                    d={dots.join('')}
                    fill={tint}
                    fillOpacity={Number(twentieths) / 20}
                  />
                )
              })}
            </Svg>
          </Animated.View>
        )
      })}
    </>
  )
})

/** How far past the field's edges, as a share of it, the deep sky is drawn: what a move can bring in before it settles. */
const DEEP_MARGIN = 0.25

/** Each tag's region as a soft cloud in its colour, three rounds a little apart. */
const Nebulae = memo(function Nebulae({
  field,
  settled: view,
  base,
  regions,
  lens,
}: Pick<SkyLayerProps, 'field' | 'settled' | 'base' | 'regions' | 'lens'>): ReactNode {
  return (
    <Svg width={field.width} height={field.height} style={StyleSheet.absoluteFill}>
      <Defs>
        {regions.map(region => (
          <RadialGradient key={region.tagId} id={`cloud-${region.tagId}`} cx="50%" cy="50%" r="50%">
            <Stop
              offset="0"
              stopColor={tagColors(region.hue, 'dark').dot}
              stopOpacity={lens === null ? 0.2 : 0.3}
            />
            <Stop offset="1" stopColor={tagColors(region.hue, 'dark').dot} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {regions.flatMap(region => {
        const middle = toScreen(view, base, region)
        const r = region.r * base * view.scale * 1.7
        return [0, 1, 2].map(lobe => (
          <Circle
            key={`${region.tagId}-${lobe}`}
            cx={middle.x + (lobe - 1) * r * 0.32}
            cy={middle.y + (lobe % 2 === 0 ? -1 : 1) * r * 0.18}
            r={r * (1 - lobe * 0.18)}
            fill={`url(#cloud-${region.tagId})`}
          />
        ))
      })}
    </Svg>
  )
})

/**
 * Every star near the screen: its glow, a circle filled with its colour's
 * gradient, and over all the glows the dots, one path a colour and step of
 * brightness. An SVG element is a native view of its own, so a star drawn as
 * a group of them (two groups and two circles) made a library of 1,500 some
 * 6,000 views to build each time the map settled, which held a phone for
 * seconds (2026-10-26).
 */
const Stars = memo(function Stars({
  points,
  settled,
  base,
  field,
  lens,
}: {
  points: readonly SkyPoint[]
  settled: MapView
  base: number
  field: FieldSize
  lens: number | null
}): ReactNode {
  const seen = visibleRect(settled, base, field)
  // A little past the edges, for the glows that reach in: the drawing ends at
  // the field's edge, so a star further out would be drawn for nothing (a
  // screen either side was, until 2026-10-26).
  const spanX = (seen.x1 - seen.x0) * 0.15
  const spanY = (seen.y1 - seen.y0) * 0.15
  const near = points.filter(
    point =>
      point.x >= seen.x0 - spanX &&
      point.x <= seen.x1 + spanX &&
      point.y >= seen.y0 - spanY &&
      point.y <= seen.y1 + spanY,
  )
  const tones = new Set(near.map(point => point.glow))
  const glows: ReactNode[] = []
  const flares: ReactNode[] = []
  // Each dot's circle, as path, by its colour and its opacity in tenths.
  const dots = new Map<string, string[]>()
  for (const point of near) {
    const at = toScreen(settled, base, point)
    const look = starLook(point, settled.scale)
    const alpha = starAlpha(point, lens)
    const fill = `url(#glow-${point.glow.slice(1)})`
    glows.push(
      <Circle
        key={point.id}
        cx={at.x}
        cy={at.y}
        r={glowReach(point, look.r, settled.scale, base)}
        fill={fill}
        opacity={alpha}
      />,
    )
    if (look.share > 0.01) {
      // An open cover's own glow behind it (K1).
      glows.push(
        <Circle
          key={`h${point.id}`}
          cx={at.x}
          cy={at.y}
          r={haloReach(point, look.side, settled.scale, base)}
          fill={fill}
          opacity={alpha * 0.5 * look.share}
        />,
      )
    }
    if (look.star <= 0.01) continue
    if (point.flare) {
      flares.push(
        <G key={point.id} opacity={alpha * look.star}>
          <Flare
            x={at.x}
            y={at.y}
            reach={flareReach(point, look.r, settled.scale, base)}
            color={point.core}
          />
        </G>,
      )
    }
    const key = `${point.core} ${Math.max(1, Math.round(alpha * look.star * 10))}`
    const r = look.r * CORE
    const dot = `M${at.x - r},${at.y}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`
    const same = dots.get(key)
    if (same) same.push(dot)
    else dots.set(key, [dot])
  }
  return (
    <Svg width={field.width} height={field.height} style={StyleSheet.absoluteFill}>
      <Defs>
        {[...tones].map(glow => (
          <RadialGradient key={glow} id={`glow-${glow.slice(1)}`} cx="50%" cy="50%" r="50%">
            {GLOW_STOPS.map(([offset, opacity]) => (
              <Stop key={offset} offset={offset} stopColor={glow} stopOpacity={opacity} />
            ))}
          </RadialGradient>
        ))}
      </Defs>
      {glows}
      {flares}
      {[...dots].map(([key, circles]) => {
        const [core, tenths] = key.split(' ')
        return <Path key={key} d={circles.join('')} fill={core} fillOpacity={Number(tenths) / 10} />
      })}
    </Svg>
  )
})

/**
 * A bright star's four-pointed flare: two thin strokes through it, the inner
 * half of each a little brighter, so it fades towards its ends.
 */
function Flare({
  x,
  y,
  reach,
  color,
}: {
  x: number
  y: number
  reach: number
  color: string
}): ReactNode {
  return (
    <>
      <Line
        x1={x - reach}
        y1={y}
        x2={x + reach}
        y2={y}
        stroke={color}
        strokeWidth={0.7}
        strokeOpacity={0.35}
      />
      <Line
        x1={x}
        y1={y - reach}
        x2={x}
        y2={y + reach}
        stroke={color}
        strokeWidth={0.7}
        strokeOpacity={0.35}
      />
      <Line
        x1={x - reach / 2}
        y1={y}
        x2={x + reach / 2}
        y2={y}
        stroke={color}
        strokeWidth={0.8}
        strokeOpacity={0.5}
      />
      <Line
        x1={x}
        y1={y - reach / 2}
        x2={x}
        y2={y + reach / 2}
        stroke={color}
        strokeWidth={0.8}
        strokeOpacity={0.5}
      />
    </>
  )
}

/**
 * Close in, the covers on screen opening from their stars, the most played
 * first, and once open their names. Each keeps its star's light (K1): a rim,
 * and its plays as brightness, the less played under a veil. Only those
 * opening ask for their pictures, and each fades in as it first appears.
 */
const Covers = memo(function Covers({
  points,
  songs,
  settled,
  base,
  field,
  lens,
}: {
  points: readonly SkyPoint[]
  songs: ReadonlyMap<number, Song>
  settled: MapView
  base: number
  field: FieldSize
  lens: number | null
}): ReactNode {
  const art = useArt(128)
  const reduced = useMotionReduced()
  const tile = tileSide(settled.scale)
  const seen = visibleRect(settled, base, field)
  const open = points
    .filter(
      point => point.x >= seen.x0 && point.x <= seen.x1 && point.y >= seen.y0 && point.y <= seen.y1,
    )
    .map(point => ({ point, look: starLook(point, settled.scale) }))
    .filter(({ look }) => look.cover > 0.01)
    // The most played on top.
    .sort((a, b) => a.point.bright - b.point.bright)
  return (
    <>
      {open.map(({ point, look }) => {
        const song = songs.get(point.id)
        const uri = song ? art(song) : null
        const at = toScreen(settled, base, point)
        const dim = lens !== null && !point.tagIds.includes(lens)
        const { side, corner } = look
        return (
          <Reanimated.View
            key={point.id}
            entering={reduced ? undefined : COVER_IN}
            style={[styles.cover, { left: at.x - side / 2, top: at.y - side / 2 }]}
          >
            <View
              style={[
                styles.coverFace,
                {
                  width: side,
                  height: side,
                  borderRadius: corner,
                  backgroundColor: point.glow,
                  borderColor: `${point.core}59`,
                  opacity: look.cover * (dim ? 0.15 : 1),
                },
              ]}
            >
              {uri ? <Image source={{ uri }} style={styles.coverImage} /> : null}
              {look.veil > 0 ? <View style={[styles.veil, { opacity: look.veil }]} /> : null}
            </View>
            {song && look.share > 0.9 && tile >= NAMES_FROM ? (
              <Text
                numberOfLines={1}
                style={[styles.coverName, { top: side + 3, width: side + 16, left: -8 }]}
              >
                {song.title}
              </Text>
            ) : null}
          </Reanimated.View>
        )
      })}
    </>
  )
})

const COVER_IN = FadeIn.duration(MOVE_MS.arrive)

/** The most played covers' glints, over the covers: their stars' flares, kept as a shine on one corner. */
const Glints = memo(function Glints({
  points,
  settled,
  base,
  field,
  lens,
}: {
  points: readonly SkyPoint[]
  settled: MapView
  base: number
  field: FieldSize
  lens: number | null
}): ReactNode {
  const seen = visibleRect(settled, base, field)
  const lit = points.flatMap(point => {
    if (!point.flare) return []
    if (point.x < seen.x0 || point.x > seen.x1 || point.y < seen.y0 || point.y > seen.y1) return []
    const look = starLook(point, settled.scale)
    return look.share > 0.01 ? [{ point, look }] : []
  })
  if (lit.length === 0) return null
  return (
    <Svg width={field.width} height={field.height} style={StyleSheet.absoluteFill}>
      {lit.map(({ point, look }) => {
        const at = toScreen(settled, base, point)
        const shine = glint(look.side)
        const x = at.x + shine.dx
        const y = at.y + shine.dy
        const dim = lens !== null && !point.tagIds.includes(lens) ? 0.15 : 1
        return (
          <G key={point.id} opacity={look.share * dim}>
            <Flare x={x} y={y} reach={shine.reach} color={point.core} />
            <Circle cx={x} cy={y} r={1.6} fill={SKY_INK} />
          </G>
        )
      })}
    </Svg>
  )
})

/** What `Marks` and `Over` need to know: where a song is drawn, and the lit song's look. */
function useMarked({
  settled,
  base,
  points,
  lit,
}: Pick<SkyLayerProps, 'settled' | 'base' | 'points' | 'lit'>) {
  const byId = useMemo(() => new Map(points.map(point => [point.id, point])), [points])
  const at = (place: MapPlace): { x: number; y: number } => toScreen(settled, base, place)
  const litPlace = lit === null ? undefined : byId.get(lit)
  // Its cover open enough to be lit on a dimmed sky (H3), rather than ringed.
  const litLook = litPlace ? starLook(litPlace, settled.scale) : null
  const litOpen = litLook !== null && litLook.share > 0.5
  return { byId, at, litPlace, litLook, litOpen }
}

/**
 * What is drawn with the sky, for where it last held still: the tray's lines
 * and loops in their colours, the playing song wearing its cover, the song
 * pressed in the tray's list ringed while it is still a star.
 */
const Marks = memo(function Marks({
  field,
  settled,
  base,
  points,
  takes,
  playing,
  lit,
  songs,
}: Pick<
  SkyLayerProps,
  'field' | 'settled' | 'base' | 'points' | 'takes' | 'playing' | 'lit' | 'songs'
>): ReactNode {
  const art = useArt(128)
  const accent = useUnistyles().theme.colors.accent
  const { byId, at, litPlace, litOpen } = useMarked({ settled, base, points, lit })
  const litAt = litPlace ? at(litPlace) : null
  // The playing song wears its cover, ringed; lit, the spotlight is its look
  // instead, or the ring's disc and white edge showed round the lit cover.
  const playingPlace = playing === null ? undefined : byId.get(playing)
  const now = litOpen && playingPlace === litPlace ? undefined : playingPlace
  const nowSong = now ? songs.get(now.id) : undefined
  const nowUri = nowSong ? art(nowSong) : null
  const nowAt = now ? at(now) : null
  const big = Math.max(22, now ? starLook(now, settled.scale).side * 1.15 : 22)
  return (
    <>
      <Svg width={field.width} height={field.height} style={StyleSheet.absoluteFill}>
        {takes.map((take, index) =>
          take.kind === 'loop' ? (
            <Path
              key={`t${index}`}
              d={`M${polyline(take.path, at).replaceAll(' ', ' L')} Z`}
              fill={take.tone}
              fillOpacity={0.07}
              stroke={take.tone}
              strokeOpacity={0.9}
              strokeWidth={1.8}
              strokeDasharray="6 5"
            />
          ) : (
            <Polyline
              key={`t${index}`}
              points={polyline(
                take.chain.flatMap(id => byId.get(id) ?? []),
                at,
              )}
              fill="none"
              stroke={take.tone}
              strokeOpacity={0.85}
              strokeWidth={1.4}
            />
          ),
        )}
        {takes.flatMap((take, index) =>
          take.ids.map(id => {
            const place = byId.get(id)
            if (!place) return null
            const spot = at(place)
            return (
              <Circle
                key={`r${index}-${id}`}
                cx={spot.x}
                cy={spot.y}
                r={ringRadius(place, settled.scale, 5.5)}
                stroke={take.tone}
                strokeOpacity={0.55}
                strokeWidth={1}
                fill="none"
              />
            )
          }),
        )}
        {nowAt ? (
          <Circle cx={nowAt.x} cy={nowAt.y} r={big * 1.05} fill={accent} fillOpacity={0.25} />
        ) : null}
        {litAt && litPlace && !litOpen ? (
          <Circle
            cx={litAt.x}
            cy={litAt.y}
            r={ringRadius(litPlace, settled.scale, 7)}
            stroke={SKY_INK}
            strokeWidth={1.5}
            fill="none"
          />
        ) : null}
      </Svg>
      {now && nowAt ? (
        <View
          style={[
            styles.playing,
            {
              left: nowAt.x - big / 2,
              top: nowAt.y - big / 2,
              width: big,
              height: big,
              borderRadius: big * 0.2,
              backgroundColor: now.glow,
            },
          ]}
        >
          {nowUri ? <Image source={{ uri: nowUri }} style={styles.coverImage} /> : null}
        </View>
      ) : null}
    </>
  )
})

/** Places as an SVG polyline's points. */
function polyline(
  places: readonly MapPlace[],
  at: (place: MapPlace) => { x: number; y: number },
): string {
  return places
    .map(place => {
      const spot = at(place)
      return `${spot.x},${spot.y}`
    })
    .join(' ')
}

/**
 * What is over the sky and changes while it holds still, so is not kept with
 * it: the stroke under the finger, the pressed spot, and the song pressed in
 * the tray's list once its cover is open, lit over the veil that dims the
 * sky (H3).
 */
function Over({
  field,
  settled,
  base,
  points,
  stroke,
  lit,
  pulse,
  songs,
  panel,
}: Pick<
  SkyLayerProps,
  'field' | 'settled' | 'base' | 'points' | 'stroke' | 'lit' | 'pulse' | 'songs' | 'panel'
>): ReactNode {
  const art = useArt(128)
  const accent = useUnistyles().theme.colors.accent
  const { at, litPlace, litLook, litOpen } = useMarked({ settled, base, points, lit })
  const litSong = litPlace ? songs.get(litPlace.id) : undefined
  return (
    <>
      {stroke.length > 1 || pulse ? (
        <Svg width={field.width} height={field.height} style={StyleSheet.absoluteFill}>
          {stroke.length > 1 ? (
            <Polyline
              points={polyline(stroke, at)}
              stroke={accent}
              strokeOpacity={0.95}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="2 7"
              fill="none"
            />
          ) : null}
          {pulse ? (
            <Circle cx={pulse.x} cy={pulse.y} r={16} fill={accent} fillOpacity={0.35} />
          ) : null}
        </Svg>
      ) : null}
      {litPlace && litSong && litLook && litOpen ? (
        <LitSpot
          song={litSong}
          uri={art(litSong)}
          glow={litPlace.glow}
          at={at(litPlace)}
          side={litLook.side}
          corner={litLook.corner}
          clear={field.width - panel}
        />
      ) : null}
    </>
  )
}

/**
 * The song pressed in the tray's list, close in (H3): the sky dims under a
 * veil and its cover alone is lit, a little larger, in a glow of its own
 * colour, its title and artist under it, kept short of the tray's panel.
 */
function LitSpot({
  song,
  uri,
  glow,
  at,
  side: open,
  corner,
  clear,
}: {
  song: Song
  uri: string | null | undefined
  glow: string
  at: { x: number; y: number }
  side: number
  corner: number
  /** Where the tray's panel begins: the words keep short of it. */
  clear: number
}): ReactNode {
  const side = Math.max(52, open * 1.15)
  const half = side / 2
  const radius = corner * (side / open)
  const middle = Math.min(at.x, clear - SPOT_WORDS / 2 - 8)
  return (
    <>
      {/* The glow is cast by a shape a little inside the cover, so none of its
          pale fill is left at the cover's soft edge as a light outline. */}
      <View
        pointerEvents="none"
        style={[
          styles.spotCover,
          {
            left: at.x - half + SPOT_INSET,
            top: at.y - half + SPOT_INSET,
            width: side - SPOT_INSET * 2,
            height: side - SPOT_INSET * 2,
            borderRadius: Math.max(0, radius - SPOT_INSET),
            backgroundColor: glow,
            boxShadow: `0 0 22px ${glow}`,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.spotCover,
          {
            left: at.x - half,
            top: at.y - half,
            width: side,
            height: side,
            borderRadius: radius,
            backgroundColor: uri ? undefined : glow,
          },
        ]}
      >
        {uri ? <Image source={{ uri }} style={styles.coverImage} /> : null}
      </View>
      <View
        pointerEvents="none"
        style={[styles.spotWords, { left: middle - SPOT_WORDS / 2, top: at.y + half + 6 }]}
      >
        <Text style={styles.spotTitle} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.spotArtist} numberOfLines={1}>
          {song.artist}
        </Text>
      </View>
    </>
  )
}

/** How wide the lit song's name may run under it. */
const SPOT_WORDS = 240
/** How far inside the lit cover's edge its glow is cast from. */
const SPOT_INSET = 2

const styles = StyleSheet.create(() => ({
  cover: { position: 'absolute' },
  coverFace: { overflow: 'hidden', borderWidth: 1 },
  coverImage: { width: '100%', height: '100%' },
  veil: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  // Over the whole sky, under the lit cover: the rest dims to about a third.
  spotVeil: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,5,11,0.68)' },
  spotCover: { position: 'absolute', overflow: 'hidden' },
  spotWords: { position: 'absolute', width: SPOT_WORDS, alignItems: 'center' },
  spotTitle: {
    color: SKY_INK,
    fontSize: type.sub,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 6,
  },
  spotArtist: { color: 'rgba(244,245,249,0.72)', fontSize: type.small },
  coverName: {
    position: 'absolute',
    textAlign: 'center',
    fontSize: type.small - 2,
    fontWeight: '600',
    color: SKY_INK,
  },
  playing: {
    position: 'absolute',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: SKY_INK,
  },
}))
