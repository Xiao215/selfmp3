import { memo, useMemo } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Image, Text, View } from 'react-native'
import type { View as ViewType } from 'react-native'
import Svg, { Circle, Defs, Path, Polyline, RadialGradient, Rect, Stop } from 'react-native-svg'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { MapPlace, Song } from '@selfmp3/shared'
import { tagColors, type } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import {
  dustSpecks,
  GLOW,
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
 * are drawn again only when it settles. Each star is a single circle filled
 * with its colour's glow, and the stars of one colour share one gradient.
 * What moves with the frame — names, the stroke, the playing song — is drawn
 * over it at screen size.
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
  const tones = new Map<string, SkyPoint>()
  for (const point of near) tones.set(`${point.glow}${point.core}`, point)
  return (
    <Svg width={field.width} height={field.height} style={StyleSheet.absoluteFill}>
      <Defs>
        {[...tones].map(([key, point]) => (
          <RadialGradient
            key={key}
            id={`glow-${key.replaceAll('#', '')}`}
            cx="50%"
            cy="50%"
            r="50%"
          >
            {GLOW_STOPS.map(([offset, opacity, middle]) => (
              <Stop
                key={offset}
                offset={offset}
                stopColor={middle ? point.core : point.glow}
                stopOpacity={opacity}
              />
            ))}
          </RadialGradient>
        ))}
      </Defs>
      {near.map(point => {
        const at = toScreen(settled, base, point)
        const r = starRadius(settled.scale, point.bright) * (covers ? 1.8 : 1) * GLOW
        return (
          <Circle
            key={point.id}
            cx={at.x}
            cy={at.y}
            r={r}
            opacity={starAlpha(point, lens)}
            fill={`url(#glow-${point.glow.replace('#', '')}${point.core.replace('#', '')})`}
          />
        )
      })}
    </Svg>
  )
})

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
 * What moves with every frame, at screen size: the tray's lines and loops,
 * the stroke under the finger, the playing song wearing its cover, the
 * pressed spot, and the tags' names over their nebulae.
 */
function Overlay({
  field,
  view,
  base,
  points,
  regions,
  takes,
  stroke,
  playing,
  pulse,
  songs,
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
              fill={accent}
              fillOpacity={0.08}
              stroke="rgba(244,245,249,0.7)"
              strokeWidth={1.4}
              strokeDasharray="5 5"
            />
          ) : (
            <Polyline
              key={`t${index}`}
              points={line(take.chain.flatMap(id => byId.get(id) ?? []))}
              fill="none"
              stroke="rgba(244,245,249,0.72)"
              strokeWidth={1.1}
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
                stroke="rgba(244,245,249,0.5)"
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
      {regions.map(region => {
        const middle = at(region)
        return (
          <View
            key={region.tagId}
            style={[
              styles.region,
              { left: middle.x - 70, top: middle.y - region.r * base * view.scale * 1.05 - 18 },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.regionName, { color: tagColors(region.hue, 'dark').ink }]}
            >
              {region.name}
            </Text>
            <Text style={[styles.regionCount, { color: tagColors(region.hue, 'dark').ink }]}>
              {region.count}
            </Text>
          </View>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create(() => ({
  layer: { position: 'absolute', left: 0, top: 0 },
  cover: { position: 'absolute' },
  coverImage: { width: '100%', height: '100%' },
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
  region: { position: 'absolute', width: 140, alignItems: 'center' },
  regionName: { fontSize: type.small - 1, fontWeight: '600', letterSpacing: 2 },
  regionCount: { fontSize: type.small - 4, opacity: 0.6, fontVariant: ['tabular-nums'] },
}))
