import { memo, useMemo } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Image, Text, View } from 'react-native'
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
import {
  CORE,
  dustSpecks,
  flareReach,
  glowReach,
  GLOW_STOPS,
  SKY_EDGE,
  SKY_INK,
  SKY_TOP,
  starAlpha,
  starRadius,
  type SkyLayerProps,
  type SkyPoint,
} from './sky.model'
import {
  COVER_FROM,
  tileSide,
  toScreen,
  visibleRect,
  type FieldSize,
  type MapView,
} from './soundMapView.model'

/** Covers this wide wear their titles underneath. */
const NAMES_FROM = 30

/**
 * The sound map's sky on a phone or an iPad (`SkyLayer.web.tsx` is the
 * browser's): the stars drawn as one SVG at the view the map last held still
 * at, and moved and scaled as a whole while a finger moves it, so 1,500 stars
 * are drawn again only when it settles. Each star is a dot over a glow that
 * keeps to the room its neighbours leave, and the stars of one colour share
 * one gradient. What moves with the frame — the stroke, the playing song —
 * is drawn over it at screen size.
 */
export function SkyLayer(
  props: SkyLayerProps & { pointerRef: RefObject<ViewType | null> },
): ReactNode {
  const { field, view, settled, base, points, lens } = props
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Ground field={field} />
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
  const covers = tileSide(settled.scale) >= COVER_FROM
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
        const r = starRadius(settled.scale, point.bright) * (covers ? 1.8 : 1)
        const alpha = starAlpha(point, lens)
        return (
          <G key={point.id} opacity={alpha}>
            <Circle
              cx={at.x}
              cy={at.y}
              r={glowReach(point, r, settled.scale, base)}
              fill={`url(#glow-${point.glow.slice(1)})`}
            />
            {covers || !point.flare ? null : (
              <Flare
                x={at.x}
                y={at.y}
                reach={flareReach(point, r, settled.scale, base)}
                color={point.core}
              />
            )}
            {covers ? null : <Circle cx={at.x} cy={at.y} r={r * CORE} fill={point.core} />}
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
 * Close in, the covers on screen in place of their stars, and closer still
 * their names. Only those on screen ask for their pictures.
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
  const side = tileSide(settled.scale)
  if (side < COVER_FROM) return null
  const seen = visibleRect(settled, base, field)
  return (
    <>
      {points.map(point => {
        if (point.x < seen.x0 || point.x > seen.x1 || point.y < seen.y0 || point.y > seen.y1) {
          return null
        }
        const song = songs.get(point.id)
        const uri = song ? art(song) : null
        const at = toScreen(settled, base, point)
        const dim = lens !== null && !point.tagIds.includes(lens)
        return (
          <View
            key={point.id}
            style={[
              styles.cover,
              {
                left: at.x - side / 2,
                top: at.y - side / 2,
                width: side,
                height: side,
                borderRadius: side * 0.16,
                backgroundColor: point.glow,
                opacity: dim ? 0.15 : 1,
              },
            ]}
          >
            {uri ? (
              <Image source={{ uri }} style={[styles.coverImage, { borderRadius: side * 0.16 }]} />
            ) : null}
            {song && side >= NAMES_FROM ? (
              <Text
                numberOfLines={1}
                style={[styles.coverName, { top: side + 3, width: side + 16, left: -8 }]}
              >
                {song.title}
              </Text>
            ) : null}
          </View>
        )
      })}
    </>
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
  const side = tileSide(view.scale)
  const covers = side >= COVER_FROM
  const now = playing === null ? undefined : byId.get(playing)
  const nowSong = now ? songs.get(now.id) : undefined
  const nowUri = nowSong ? art(nowSong) : null
  const nowAt = now ? at(now) : null
  const big = Math.max(22, covers ? side * 1.15 : 22)
  const litPlace = lit === null ? undefined : byId.get(lit)
  const litAt = litPlace ? at(litPlace) : null
  const litSong = litPlace ? songs.get(litPlace.id) : undefined
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
                r={covers ? side * 0.7 : 5.5}
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
        {litAt && !covers ? (
          <Circle
            cx={litAt.x}
            cy={litAt.y}
            r={covers ? side * 0.72 : 7}
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
      {litPlace && litAt && litSong && covers ? (
        <LitCard
          song={litSong}
          uri={art(litSong)}
          glow={litPlace.glow}
          at={litAt}
          side={side}
          clear={field.width - panel}
          field={field}
        />
      ) : null}
    </>
  )
}

/**
 * The song pressed in the tray's list, close in: its cover lifted into a dark
 * card with its title and artist (H2), on whichever side of its star has room.
 */
function LitCard({
  song,
  uri,
  glow,
  at,
  side,
  clear,
  field,
}: {
  song: Song
  uri: string | null | undefined
  glow: string
  at: { x: number; y: number }
  side: number
  /** Where the tray's panel begins: the words keep short of it. */
  clear: number
  field: FieldSize
}): ReactNode {
  const big = Math.max(52, Math.min(96, side * 1.3))
  const edge = big / 2 + 4
  const left = at.x + edge + 240 < clear
  return (
    <View
      pointerEvents="none"
      style={[
        styles.card,
        left
          ? { left: at.x - edge, top: at.y - edge }
          : { right: field.width - at.x - edge, top: at.y - edge, flexDirection: 'row-reverse' },
      ]}
    >
      <View style={[styles.cardCover, { width: big, height: big, backgroundColor: glow }]}>
        {uri ? <Image source={{ uri }} style={styles.coverImage} /> : null}
      </View>
      <View style={styles.cardWords}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.cardArtist} numberOfLines={1}>
          {song.artist}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create(() => ({
  layer: { position: 'absolute', left: 0, top: 0 },
  cover: { position: 'absolute' },
  coverImage: { width: '100%', height: '100%' },
  card: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 4,
    paddingRight: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(31,34,44,0.96)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
  },
  cardCover: { borderRadius: 10, overflow: 'hidden' },
  cardWords: { maxWidth: 220 },
  cardTitle: { color: SKY_INK, fontSize: type.sub, fontWeight: '600' },
  cardArtist: { color: 'rgba(244,245,249,0.68)', fontSize: type.small },
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
