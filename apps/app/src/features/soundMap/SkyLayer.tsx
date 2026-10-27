import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Animated, Easing, Image, Text, View } from 'react-native'
import Reanimated, { FadeIn } from 'react-native-reanimated'
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
import { tileSide, toScreen, visibleRect, type FieldSize, type MapView } from './soundMapView.model'

/** Covers this wide wear their titles underneath. */
const NAMES_FROM = 30

/**
 * The sound map's sky on a phone or an iPad (`SkyLayer.web.tsx` is the
 * browser's): the stars drawn as one SVG at the view the map last held still
 * at, and moved and scaled as a whole while a finger moves it, so 1,500 stars
 * are drawn again only when it settles. Each star is a dot over a glow that
 * keeps to the room its neighbours leave, and the stars of one colour share
 * one gradient. Close in, each opens into its cover, the most played first
 * (`starLook`). Behind them the deep sky twinkles (`DeepSky`). What moves with
 * the frame — the stroke, the playing song — is drawn over it at screen size.
 */
export function SkyLayer(
  props: SkyLayerProps & { pointerRef: RefObject<ViewType | null> },
): ReactNode {
  const { field, view, settled, base, points, lens } = props
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Ground field={field} />
      {props.still ? null : <DeepSky field={field} view={view} settled={settled} />}
      <Nebulae {...props} />
      <View
        style={[
          styles.layer,
          { width: field.width, height: field.height },
          sinceSettled(view, settled),
        ]}
      >
        <Stars points={points} settled={settled} base={base} field={field} lens={lens} />
        <Covers
          points={points}
          songs={props.songs}
          settled={settled}
          base={base}
          field={field}
          lens={lens}
        />
        <Glints points={points} settled={settled} base={base} field={field} lens={lens} />
      </View>
      <Overlay {...props} />
    </View>
  )
}

/**
 * How far the map has moved since the stars were drawn: they are drawn where
 * the settled view put them, and a gesture in progress moves and scales that
 * drawing as a whole until it settles again.
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
 * the view the map last held still at and moved, a part as far as the map
 * does, while a finger moves it (`deepSince`). Each is a small view of its own
 * in a group that follows one of three slow twinkles, run on the native side,
 * so nothing is drawn again while they twinkle. Under Reduce Motion they hold
 * still, and so they do while another page is over the map.
 */
function DeepSky({
  field,
  view,
  settled,
}: {
  field: FieldSize
  view: MapView
  settled: MapView
}): ReactNode {
  const layers = useMemo(() => deepStars(), [])
  const reduced = useMotionReduced()
  const beats = useBeats(useFocused() && !reduced)
  return (
    <View style={StyleSheet.absoluteFill}>
      {layers.map((stars, layer) => {
        const parallax = DEEP_LAYERS[layer]!.parallax
        const since = deepSince(view, settled, parallax)
        return (
          <View
            key={layer}
            style={[
              StyleSheet.absoluteFill,
              {
                transform: [
                  { translateX: since.x },
                  { translateY: since.y },
                  { scale: since.scale },
                ],
              },
            ]}
          >
            <DeepLayer
              stars={stars}
              parallax={parallax}
              settled={settled}
              field={field}
              beats={beats}
            />
          </View>
        )
      })}
    </View>
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
  const placed = deepPlaces(stars, parallax, settled, field, 0.25)
  return (
    <>
      {DEEP_BEATS_MS.map((_, beat) => {
        const own = placed.filter(({ star }) => star.beat === beat)
        const opacity = beats
          ? beats[beat]!.interpolate({ inputRange: [0, 1], outputRange: [TWINKLE_LOW, 1] })
          : 1
        return (
          <Animated.View key={beat} style={[StyleSheet.absoluteFill, { opacity }]}>
            {own.map(({ star, x, y, size }, index) => (
              <View
                key={index}
                style={[
                  styles.deepStar,
                  {
                    left: x - size / 2,
                    top: y - size / 2,
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: star.tint,
                    opacity: star.opacity,
                  },
                ]}
              />
            ))}
          </Animated.View>
        )
      })}
    </>
  )
})

/** Each tag's region as a soft cloud in its colour, three rounds a little apart. */
function Nebulae({ field, view, base, regions, lens }: SkyLayerProps): ReactNode {
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
}

/** Every star near the screen, each one circle filled with its colour's glow. */
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
  // A screen's width either side: what a move can bring in before it settles.
  const spanX = seen.x1 - seen.x0
  const spanY = seen.y1 - seen.y0
  const near = points.filter(
    point =>
      point.x >= seen.x0 - spanX &&
      point.x <= seen.x1 + spanX &&
      point.y >= seen.y0 - spanY &&
      point.y <= seen.y1 + spanY,
  )
  const tones = new Set(near.map(point => point.glow))
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
      {near.map(point => {
        const at = toScreen(settled, base, point)
        const look = starLook(point, settled.scale)
        const alpha = starAlpha(point, lens)
        const glow = `url(#glow-${point.glow.slice(1)})`
        return (
          <G key={point.id} opacity={alpha}>
            <Circle
              cx={at.x}
              cy={at.y}
              r={glowReach(point, look.r, settled.scale, base)}
              fill={glow}
            />
            {look.share > 0.01 ? (
              // An open cover's own glow behind it (K1).
              <Circle
                cx={at.x}
                cy={at.y}
                r={haloReach(point, look.side, settled.scale, base)}
                fill={glow}
                opacity={0.5 * look.share}
              />
            ) : null}
            {look.star > 0.01 ? (
              <G opacity={look.star}>
                {point.flare ? (
                  <Flare
                    x={at.x}
                    y={at.y}
                    reach={flareReach(point, look.r, settled.scale, base)}
                    color={point.core}
                  />
                ) : null}
                <Circle cx={at.x} cy={at.y} r={look.r * CORE} fill={point.core} />
              </G>
            ) : null}
          </G>
        )
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

/**
 * What moves with every frame, at screen size: the tray's lines and loops in
 * their colours, the stroke under the finger, the playing song wearing its
 * cover, the song pressed in the tray's list, the pressed spot.
 */
function Overlay({
  field,
  view,
  base,
  points,
  takes,
  stroke,
  playing,
  lit,
  pulse,
  songs,
  panel,
}: SkyLayerProps): ReactNode {
  const art = useArt(128)
  const accent = useUnistyles().theme.colors.accent
  const byId = useMemo(() => new Map(points.map(point => [point.id, point])), [points])
  const at = (place: MapPlace): { x: number; y: number } => toScreen(view, base, place)
  const litPlace = lit === null ? undefined : byId.get(lit)
  const litAt = litPlace ? at(litPlace) : null
  const litSong = litPlace ? songs.get(litPlace.id) : undefined
  // Its cover open enough to be lit on a dimmed sky (H3), rather than ringed.
  const litLook = litPlace ? starLook(litPlace, view.scale) : null
  const litOpen = litLook !== null && litLook.share > 0.5
  // The playing song wears its cover, ringed; lit, the spotlight is its look
  // instead, or the ring's disc and white edge showed round the lit cover.
  const playingPlace = playing === null ? undefined : byId.get(playing)
  const now = litOpen && playingPlace === litPlace ? undefined : playingPlace
  const nowSong = now ? songs.get(now.id) : undefined
  const nowUri = nowSong ? art(nowSong) : null
  const nowAt = now ? at(now) : null
  const big = Math.max(22, now ? starLook(now, view.scale).side * 1.15 : 22)
  const line = (places: readonly MapPlace[]): string =>
    places
      .map(place => {
        const spot = at(place)
        return `${spot.x},${spot.y}`
      })
      .join(' ')
  return (
    <>
      <Svg width={field.width} height={field.height} style={StyleSheet.absoluteFill}>
        {takes.map((take, index) =>
          take.kind === 'loop' ? (
            <Path
              key={`t${index}`}
              d={`M${line(take.path).replaceAll(' ', ' L')} Z`}
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
              points={line(take.chain.flatMap(id => byId.get(id) ?? []))}
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
                r={ringRadius(place, view.scale, 5.5)}
                stroke={take.tone}
                strokeOpacity={0.55}
                strokeWidth={1}
                fill="none"
              />
            )
          }),
        )}
        {stroke.length > 1 ? (
          <Polyline
            points={line(stroke)}
            stroke={accent}
            strokeOpacity={0.95}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2 7"
            fill="none"
          />
        ) : null}
        {nowAt ? (
          <Circle cx={nowAt.x} cy={nowAt.y} r={big * 1.05} fill={accent} fillOpacity={0.25} />
        ) : null}
        {litAt && !litOpen ? (
          <Circle
            cx={litAt.x}
            cy={litAt.y}
            r={litPlace ? ringRadius(litPlace, view.scale, 7) : 7}
            stroke={SKY_INK}
            strokeWidth={1.5}
            fill="none"
          />
        ) : null}
        {pulse ? (
          <Circle cx={pulse.x} cy={pulse.y} r={16} fill={accent} fillOpacity={0.35} />
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
      {litPlace && litAt && litSong && litLook && litOpen ? (
        <LitSpot
          song={litSong}
          uri={art(litSong)}
          glow={litPlace.glow}
          at={litAt}
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
      <View pointerEvents="none" style={styles.spotVeil} />
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
  layer: { position: 'absolute', left: 0, top: 0 },
  deepStar: { position: 'absolute' },
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
