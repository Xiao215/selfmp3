import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { PixelRatio, View } from 'react-native'
import type { View as ViewType } from 'react-native'
import { useFocusEffect } from 'expo-router'
import {
  BlendMode,
  BlurStyle,
  Canvas,
  ClipOp,
  createPicture,
  FilterMode,
  FontWeight,
  Group,
  MipmapMode,
  PaintStyle,
  Picture,
  Rect,
  Skia,
  StrokeCap,
  StrokeJoin,
  TextAlign,
  TileMode,
  type SkCanvas,
  type SkColor,
  type SkData,
  type SkImage,
  type SkPaint,
  type SkParagraph,
  type SkPicture,
} from '@shopify/react-native-skia'
import {
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { useUnistyles } from 'react-native-unistyles'
import {
  createWorkletRuntime,
  scheduleOnRN,
  scheduleOnRuntime,
  type WorkletRuntime,
} from 'react-native-worklets'
import type { MapPlace, Song } from '@selfmp3/shared'
import { tagColors } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { useMotionReduced } from '../../ui/motion'
import {
  CORE,
  DEEP_LAYERS,
  deepBeat,
  deepPlaces,
  deepSince,
  deepStars,
  dustSpecks,
  flareReach,
  glint,
  glowReach,
  GLOW_STOPS,
  haloReach,
  NAME_GAP,
  NAME_HEIGHT,
  NAME_SPILL,
  NAMES_FROM,
  namedCovers,
  pointsIn,
  ringRadius,
  SKY_EDGE,
  SKY_INK,
  SKY_TOP,
  skyGrid,
  skyRgba,
  SPOTLIGHT_DIM,
  SPOTLIGHT_INSET,
  spotlightSide,
  TWINKLE_FRAME_MS,
  addressesOf,
  COVERS_KEPT,
  GLOW_SIDE,
  starAlpha,
  starLook,
  TWINKLE_LOW,
  type DeepStar,
  type SkyGrid,
  type SkyLayerProps,
  type SkyPoint,
  type StarLook,
} from './sky.model'
import {
  TILE_MOST,
  tileSide,
  toMap,
  toScreen,
  type FieldSize,
  type MapView,
} from './soundMapView.model'

/**
 * The sound map's sky on a phone or an iPad (`SkyLayer.web.tsx` is the
 * browser's), drawn with Skia on the GPU: one canvas for the songs over one
 * for the ground and the deep sky.
 *
 * The songs are recorded as a picture for where the map is, a little past
 * the screen's edges, and the native side moves and scales that picture each
 * frame from the field's view, a shared value the gestures move on the UI
 * thread (`fieldMotion`), so a move costs React and the JS thread nothing.
 * A picture is drawing commands, not pixels: scaled while a pinch goes on, it
 * is drawn again from them, sharp. Once the map has moved far enough from
 * where it was recorded that its edge or its stars' sizes would show
 * (`drifted`), and whenever the map settles, it is recorded again, at most
 * once in `REDRAW_MS` while it moves.
 *
 * Until 2026-10-31 the sky was SVG and views: every settle built thousands of
 * native views (200–600 ms on the simulator, while the next touch waited), a
 * pinch scaled a snapshot of pixels until it went soft and blocky, and a pan
 * showed empty sky at the edges until the finger lifted.
 */
export function SkyLayer(
  props: SkyLayerProps & {
    view: SharedValue<MapView>
    pointerRef: RefObject<ViewType | null>
  },
): ReactNode {
  const { view } = props
  const [anchor, setAnchor] = useState<MapView>(props.settled)
  const { field } = props
  // The deep sky moves a part as far as the songs do: recorded again only once
  // it would show its edge, not each time the songs are.
  const onDrawn = useCallback(
    (at: MapView) => setAnchor(was => (deepDrifted(at, was, field) ? at : was)),
    [field],
  )
  return (
    <View style={FILL} pointerEvents="none">
      <DeepSky field={field} view={view} anchor={anchor} still={props.still ?? false} />
      <SongSky {...props} view={view} onDrawn={onDrawn} />
    </View>
  )
}

const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const

/**
 * Whether the deep sky recorded for `from` would no longer do at `to`: the
 * layer that follows the map most (`DEEP_LAYERS`) has moved or shrunk until
 * its recorded edge (`DEEP_MARGIN`) is near the screen's.
 */
function deepDrifted(to: MapView, from: MapView, field: FieldSize): boolean {
  if (to.turned !== from.turned) return true
  const moved = deepSince(to, from, Math.max(...DEEP_LAYERS.map(layer => layer.parallax)))
  const reach = (side: number): number =>
    side * (0.5 + DEEP_MARGIN) * Math.min(1, moved.scale) - (side * DEEP_MARGIN) / 3
  return (
    moved.scale > REDRAW_ZOOM ||
    Math.abs(moved.x) + field.width / 2 > reach(field.width) ||
    Math.abs(moved.y) + field.height / 2 > reach(field.height)
  )
}

/**
 * How far the map has moved from `from` to `to`, as a transform about the
 * canvas's corner: a drawing made for `from`, moved and scaled by this,
 * stands where `to` would draw it.
 */
function since(to: MapView, from: MapView) {
  'worklet'
  const ratio = to.scale / from.scale
  return [
    { translateX: to.x - from.x * ratio },
    { translateY: to.y - from.y * ratio },
    { scale: ratio },
  ]
}

/** How far past the field's edges, as a share of it, the songs are recorded: what a move can bring in before it is recorded again. */
const MARGIN = 0.35
/** A zoom this far either way from the recording is recorded again, so stars keep their size and covers open as they should. */
const REDRAW_ZOOM = 1.25
/** Recorded again at most this often while the map moves. */
const REDRAW_MS = 90
/** The map held still this long: covers arriving are recorded in at once. */
const STILL_MS = 250

/** Whether the picture recorded for `from` no longer does for `to`: its edge is near the screen, or the zoom has gone far from it. */
function drifted(to: MapView, from: MapView, field: FieldSize): boolean {
  'worklet'
  const ratio = to.scale / from.scale
  if (ratio > REDRAW_ZOOM || ratio < 1 / REDRAW_ZOOM || to.turned !== from.turned) return true
  const mx = field.width * MARGIN
  const my = field.height * MARGIN
  const tx = to.x - from.x * ratio
  const ty = to.y - from.y * ratio
  // The recorded rectangle, where it is now, must still reach past the screen by a third of its margin.
  return (
    tx - ratio * mx > -mx / 3 ||
    ty - ratio * my > -my / 3 ||
    tx + ratio * (field.width + mx) < field.width + mx / 3 ||
    ty + ratio * (field.height + my) < field.height + my / 3
  )
}

/** A recording and the view it was made for. */
interface Drawn {
  readonly picture: SkPicture
  readonly view: MapView
}

const EMPTY = createPicture(() => {})

/**
 * The songs: nebulae, stars, covers, what the tray holds and the song
 * playing, recorded together; over them, recorded apart since they change
 * while the sky does not, the stroke being drawn, the pressed spot and the
 * song lit from the tray.
 */
function SongSky(
  props: SkyLayerProps & { view: SharedValue<MapView>; onDrawn: (view: MapView) => void },
): ReactNode {
  const { field, settled, view, onDrawn } = props
  const art = useArt(128)
  const accent = useUnistyles().theme.colors.accent
  const grid = useMemo(() => skyGrid(props.points), [props.points])
  const byId = useMemo(() => new Map(props.points.map(point => [point.id, point])), [props.points])
  const sky = useSharedValue<Drawn | null>(null)
  const over = useSharedValue<Drawn | null>(null)
  // Covers arriving ask for the sky to be recorded again, a burst of them once.
  const [covers, setCovers] = useState(0)
  const arrived = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    return () => {
      timer ??= setTimeout(() => {
        timer = null
        setCovers(n => n + 1)
      }, 60)
    }
  }, [])

  const latest = useRef({ props, art, accent, grid, byId, covers })
  useLayoutEffect(() => {
    latest.current = { props, art, accent, grid, byId, covers }
  })
  const recorded = useRef<{
    view: MapView
    at: number
    art: typeof art
    covers: number
  } | null>(null)
  // When the map last moved, on the UI thread: covers arriving meanwhile wait for the next recording.
  const movedAt = useSharedValue(0)
  // A recording asked of the JS thread and not yet made: asked once, however many frames drift meanwhile.
  const asked = useSharedValue(false)
  const record = useCallback(
    (at: MapView) => {
      const now = latest.current
      coverRecord++
      coverLoads = 0
      const addresses = addressesOf(now.art)
      const cover = (song: Song): SkImage | null => {
        let uri = addresses.get(song.id)
        if (uri === undefined && !addresses.has(song.id)) {
          uri = now.art(song)
          addresses.set(song.id, uri)
        }
        return coverImage(uri, arrived)
      }
      const bounds = Skia.XYWHRect(
        -field.width * MARGIN,
        -field.height * MARGIN,
        field.width * (1 + MARGIN * 2),
        field.height * (1 + MARGIN * 2),
      )
      const picture = createPicture(
        canvas => paintSky(canvas, now.props, at, now.grid, now.byId, now.accent, cover),
        bounds,
      )
      sky.set({ picture, view: at })
      asked.set(false)
      recorded.current = { view: at, at: Date.now(), art: now.art, covers: now.covers }
      onDrawn(at)
    },
    [arrived, asked, field, onDrawn, sky],
  )

  // Settled, or anything drawn changed: recorded for where the map is.
  const { points, songs, regions, lens, takes, playing, panel, base } = props
  // What the keys chose is lit as a song from the tray is: VoiceOver rings the field itself.
  const lit = props.chosen ?? props.lit
  useLayoutEffect(() => {
    latest.current = { props, art, accent, grid, byId, covers }
    record(view.get())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `props` itself is new each render; what is drawn from it is listed.
  }, [record, view, settled, points, songs, regions, lens, takes, playing, lit, accent])

  // Covers that arrived, or moved, recorded in at once while the map holds
  // still. While it moves they wait for the recording the move brings or the
  // one it settles with: each burst of them was a whole recording mid-move,
  // several a second as new covers came on screen (2026-11-12).
  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const recordWhenStill = (): void => {
      timer = null
      const last = recorded.current
      if (last && last.art === art && last.covers === covers) return
      const wait = STILL_MS - (Date.now() - movedAt.get())
      if (wait > 0) timer = setTimeout(recordWhenStill, wait)
      else record(view.get())
    }
    recordWhenStill()
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [art, covers, view, movedAt, record])

  // Moving, recorded again once the picture no longer does: watched on the
  // UI thread, where the map moves, and asked of the JS thread once, at most
  // once in `REDRAW_MS`.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const redraw = useCallback(() => {
    const last = recorded.current
    if (timer.current || !last) return
    timer.current = setTimeout(
      () => {
        timer.current = null
        const now = view.get()
        if (recorded.current && drifted(now, recorded.current.view, field)) record(now)
        else asked.set(false)
      },
      Math.max(0, REDRAW_MS - (Date.now() - last.at)),
    )
  }, [asked, field, record, view])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    },
    [],
  )
  useAnimatedReaction(
    () => view.value,
    (next, before) => {
      if (before === null || next === before) return
      movedAt.set(Date.now())
      const drawn = sky.value
      if (asked.value || !drawn || !drifted(next, drawn.view, field)) return
      asked.set(true)
      scheduleOnRN(redraw)
    },
    [field, redraw],
  )

  // What is over the sky, recorded for where the map is when it changes.
  const { stroke, pulse } = props
  const litPlace = lit === null ? undefined : byId.get(lit)
  const litOpen = litPlace !== undefined && starLook(litPlace, settled.scale).share > 0.5
  useLayoutEffect(() => {
    const at = view.get()
    const litSong = litPlace ? songs.get(litPlace.id) : undefined
    const image = litSong && litOpen ? coverImage(art(litSong), arrived) : null
    const picture = createPicture(canvas =>
      paintOver(canvas, { stroke, pulse, accent, field, panel, base }, at, {
        place: litOpen ? litPlace : undefined,
        song: litSong,
        image,
      }),
    )
    over.set({ picture, view: at })
  }, [
    accent,
    arrived,
    art,
    base,
    covers,
    field,
    litOpen,
    litPlace,
    over,
    panel,
    pulse,
    songs,
    stroke,
    view,
  ])

  const skyPicture = useDerivedValue(() => sky.value?.picture ?? EMPTY)
  const skyMove = useDerivedValue(() =>
    sky.value ? since(view.value, sky.value.view) : [{ scale: 1 }],
  )
  const overPicture = useDerivedValue(() => over.value?.picture ?? EMPTY)
  const overMove = useDerivedValue(() =>
    over.value ? since(view.value, over.value.view) : [{ scale: 1 }],
  )
  return (
    <Canvas style={FILL}>
      <Group transform={skyMove}>
        <Picture picture={skyPicture} />
      </Group>
      {/* The song lit from the tray, close in: the rest of the sky dims to about a third (H3). */}
      {litOpen ? (
        <Rect x={0} y={0} width={field.width} height={field.height} color="rgba(4,5,11,0.68)" />
      ) : null}
      <Group transform={overMove}>
        <Picture picture={overPicture} />
      </Group>
    </Canvas>
  )
}

// The deep sky ————————————————————————————————————————————————————————————

/**
 * The ground and the deep sky (K3): faint stars that are not songs, each
 * layer recorded for where the songs were last recorded (`anchor`) and moved
 * a part as far as the map is, on the native side (`deepSince`). Each star
 * follows one of three slow twinkles; a twinkle is a group's opacity, so
 * nothing is recorded again while they twinkle, and the canvas is drawn at
 * most once in `TWINKLE_FRAME_MS`. Under Reduce Motion they hold still, and
 * so they do while another page is over the map. On a canvas of its own, so
 * a twinkle never draws the songs again.
 */
function DeepSky({
  field,
  view,
  anchor,
  still,
}: {
  field: FieldSize
  view: SharedValue<MapView>
  anchor: MapView
  still: boolean
}): ReactNode {
  const ground = useMemo(() => groundPicture(field), [field])
  const layers = useMemo(() => (still ? [] : deepStars()), [still])
  const reduced = useMotionReduced()
  const focused = useFocused()
  const twinkle = !still && !reduced && focused
  const pictures = useMemo(
    () =>
      layers.map((stars, layer) =>
        deepPictures(stars, DEEP_LAYERS[layer]!.parallax, anchor, field),
      ),
    [anchor, field, layers],
  )
  const drawnFor = useSharedValue(anchor)
  useLayoutEffect(() => {
    drawnFor.value = anchor
  }, [anchor, drawnFor])
  const ms = useSharedValue(0)
  const clock = useFrameCallback(frame => {
    'worklet'
    // A step every so often, not every frame: a twinkle is slow, and each step draws the canvas.
    if (frame.timestamp - ms.value >= TWINKLE_FRAME_MS) ms.value = frame.timestamp
  }, false)
  useEffect(() => {
    clock.setActive(twinkle)
  }, [clock, twinkle])
  const beat0 = useBeat(ms, 0, twinkle)
  const beat1 = useBeat(ms, 1, twinkle)
  const beat2 = useBeat(ms, 2, twinkle)
  const beats = [beat0, beat1, beat2]
  const near = useDerivedValue(() =>
    deepMove(view.value, drawnFor.value, DEEP_LAYERS[0].parallax, field),
  )
  const far = useDerivedValue(() =>
    deepMove(view.value, drawnFor.value, DEEP_LAYERS[1].parallax, field),
  )
  return (
    <Canvas style={FILL}>
      <Picture picture={ground} />
      {pictures.map((byBeat, layer) => (
        <Group key={layer} transform={layer === 0 ? near : far}>
          {byBeat.map((picture, beat) => (
            <Group key={beat} opacity={beats[beat]}>
              <Picture picture={picture} />
            </Group>
          ))}
        </Group>
      ))}
    </Canvas>
  )
}

/** How far past the field's edges, as a share of it, the deep sky is recorded. */
const DEEP_MARGIN = 0.25

function useBeat(ms: SharedValue<number>, beat: 0 | 1 | 2, twinkle: boolean): SharedValue<number> {
  return useDerivedValue(() =>
    twinkle ? TWINKLE_LOW + (1 - TWINKLE_LOW) * deepBeat(beat, ms.value) : 1,
  )
}

/** `deepSince` about the field's middle, as a transform about the canvas's corner. */
function deepMove(to: MapView, from: MapView, parallax: number, field: FieldSize) {
  'worklet'
  const moved = deepSince(to, from, parallax)
  const cx = field.width / 2
  const cy = field.height / 2
  return [
    { translateX: cx + moved.x - cx * moved.scale },
    { translateY: cy + moved.y - cy * moved.scale },
    { scale: moved.scale },
  ]
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

/** The night ground and its dust, for the field's size. */
function groundPicture(field: FieldSize): SkPicture {
  return createPicture(canvas => {
    const paint = Skia.Paint()
    paint.setShader(
      Skia.Shader.MakeRadialGradient(
        Skia.Point(field.width / 2, field.height * 0.45),
        Math.max(field.width, field.height) * 0.8,
        [colorOf(SKY_TOP), colorOf(SKY_EDGE)],
        null,
        TileMode.Clamp,
      ),
    )
    canvas.drawRect(Skia.XYWHRect(0, 0, field.width, field.height), paint)
    const speck = Skia.Paint()
    speck.setColor(colorOf('#c8d2ff'))
    for (const dust of dustSpecks(field, 260)) {
      speck.setAlphaf(dust.opacity)
      canvas.drawRect(Skia.XYWHRect(dust.x, dust.y, dust.side, dust.side), speck)
    }
  })
}

/** One layer's stars, for a view, one picture for each of the three twinkles. */
function deepPictures(
  stars: readonly DeepStar[],
  parallax: number,
  view: MapView,
  field: FieldSize,
): SkPicture[] {
  const placed = deepPlaces(stars, parallax, view, field, DEEP_MARGIN)
  return [0, 1, 2].map(beat =>
    createPicture(canvas => {
      const paint = Skia.Paint()
      paint.setAntiAlias(true)
      for (const { star, x, y, size } of placed) {
        if (star.beat !== beat) continue
        paint.setColor(colorOf(star.tint))
        paint.setAlphaf(star.opacity)
        canvas.drawCircle(x, y, size / 2, paint)
      }
    }),
  )
}

// Recording the songs ————————————————————————————————————————————————————

/**
 * Colours parsed from their CSS text, once: a recording asks for the same few
 * hundred, star after star, and each parse is a call across to Skia.
 */
const parsed = new Map<string, SkColor>()
function colorOf(css: string): SkColor {
  const kept = parsed.get(css)
  if (kept) return kept
  const color = Skia.Color(css)
  if (parsed.size > 4000) parsed.clear()
  parsed.set(css, color)
  return color
}

/** One glow a colour: a small picture of the falloff, drawn at each star's size. */
const glows = new Map<string, SkImage>()
const GLOW_SOURCE = Skia.XYWHRect(0, 0, GLOW_SIDE, GLOW_SIDE)

function glowOf(glow: string): SkImage | null {
  const kept = glows.get(glow)
  if (kept) return kept
  const surface = Skia.Surface.Make(GLOW_SIDE, GLOW_SIDE)
  if (!surface) return null
  const half = GLOW_SIDE / 2
  const paint = Skia.Paint()
  paint.setShader(
    Skia.Shader.MakeRadialGradient(
      Skia.Point(half, half),
      half,
      GLOW_STOPS.map(([, opacity]) => colorOf(skyRgba(glow, opacity))),
      GLOW_STOPS.map(([offset]) => offset),
      TileMode.Clamp,
    ),
  )
  surface.getCanvas().drawRect(GLOW_SOURCE, paint)
  surface.flush()
  const image = surface.makeImageSnapshot()
  glows.set(glow, image)
  return image
}

// The covers asked for, by address, the most recent last (`COVERS_KEPT`): never
// one drawn in the recording under way, so a crowd of covers on screen is never
// let go and asked for again.
/** At most this many covers start loading a recording. */
const COVER_LOADS_A_RECORD = 24
const coverCache = new Map<string, { image: SkImage | null; record: number }>()
let coverRecord = 0
let coverLoads = 0

function coverImage(uri: string | null | undefined, arrived: () => void): SkImage | null {
  if (!uri) return null
  const kept = coverCache.get(uri)
  if (kept) {
    coverCache.delete(uri)
    kept.record = coverRecord
    coverCache.set(uri, kept)
    return kept.image
  }
  if (coverLoads >= COVER_LOADS_A_RECORD) return null
  coverLoads++
  const entry: { image: SkImage | null; record: number } = { image: null, record: coverRecord }
  coverCache.set(uri, entry)
  Skia.Data.fromURI(uri)
    .then(data =>
      decode(data, image => {
        entry.image = image
        if (image) arrived()
      }),
    )
    // A cover that does not load leaves its star drawn without one.
    .catch(() => undefined)
  for (const [oldest, each] of coverCache) {
    if (coverCache.size <= COVERS_KEPT || each.record === coverRecord) break
    coverCache.delete(oldest)
  }
  return null
}

/** A cover's side in pixels where the sky draws it largest: lit, or playing, close in. */
const COVER_PIXELS = Math.ceil(spotlightSide(TILE_MOST) * PixelRatio.get())

/**
 * Covers are decoded on a thread of their own (`decodedSmall`): on the JS
 * thread, which the gestures move the map from, each decode held a move up.
 */
let decoder: WorkletRuntime | null = null
function decode(data: SkData, then: (image: SkImage | null) => void): void {
  decoder ??= createWorkletRuntime({ name: 'sky-covers' })
  scheduleOnRuntime(
    decoder,
    (bytes: SkData, side: number) => {
      'worklet'
      scheduleOnRN(then, decodedSmall(bytes, side))
    },
    data,
    COVER_PIXELS,
  )
}

/**
 * A cover decoded once, at the size the sky draws it: at most `most` pixels square.
 * Left encoded, a cover was decoded on the UI thread by the first frame that
 * drew it, from the 640-pixel copy a phone keeps, and decoded again whenever
 * the GPU's cache had let it go: a few hundred covers at 1.6 MB each outgrew
 * that cache, so moving about the map close in decoded covers frame after
 * frame, and it grew heavier the longer it was moved (2026-11-12).
 */
function decodedSmall(data: SkData, most: number): SkImage | null {
  'worklet'
  const encoded = Skia.Image.MakeImageFromEncoded(data)
  if (!encoded) return null
  const width = encoded.width()
  const height = encoded.height()
  const side = Math.min(most, Math.max(width, height))
  const surface = Skia.Surface.Make(side, side)
  if (!surface) return encoded.makeNonTextureImage()
  // Squeezed square, as the sky draws a cover; mipmapped, so the smaller copy is not grainy.
  surface
    .getCanvas()
    .drawImageRectOptions(
      encoded,
      Skia.XYWHRect(0, 0, width, height),
      Skia.XYWHRect(0, 0, side, side),
      FilterMode.Linear,
      MipmapMode.Linear,
    )
  surface.flush()
  return surface.makeImageSnapshot()
}

/** Laid-out names, by text, size and width: the same names are recorded again at every move. */
const names = new Map<string, SkParagraph>()
function nameOf(
  text: string,
  width: number,
  size: number,
  weight: FontWeight,
  color: string,
  shadow = false,
): SkParagraph {
  const key = `${text}\u0000${Math.round(width)}\u0000${size}\u0000${weight}\u0000${color}\u0000${shadow}`
  const kept = names.get(key)
  if (kept) return kept
  const paragraph = Skia.ParagraphBuilder.Make({
    maxLines: 1,
    ellipsis: '…',
    textAlign: TextAlign.Center,
  })
    // Skia takes no `undefined` here: a style without a shadow leaves the key out.
    .pushStyle({
      color: colorOf(color),
      fontSize: size,
      fontStyle: { weight },
      ...(shadow
        ? {
            shadows: [
              { color: colorOf('rgba(0,0,0,0.85)'), blurRadius: 6, offset: Skia.Point(0, 0) },
            ],
          }
        : {}),
    })
    .addText(text)
    .pop()
    .build()
  paragraph.layout(width)
  if (names.size > 600) names.clear()
  names.set(key, paragraph)
  return paragraph
}

function paintSky(
  canvas: SkCanvas,
  props: SkyLayerProps,
  view: MapView,
  grid: SkyGrid,
  byId: ReadonlyMap<number, SkyPoint>,
  accent: string,
  cover: (song: Song) => SkImage | null,
): void {
  const { field, base, regions, lens, takes, playing, songs } = props
  const at = (place: MapPlace): { x: number; y: number } => toScreen(view, base, place)
  const paint = Skia.Paint()
  paint.setAntiAlias(true)
  const white = colorOf('#ffffff')

  // The nebulae: each tag's region, a soft cloud in its colour, a little off round.
  const cloud = Skia.Paint()
  cloud.setBlendMode(BlendMode.Plus)
  for (const region of regions) {
    const middle = at(region)
    const r = region.r * base * view.scale * 1.7
    const color = tagColors(region.hue, 'dark').dot
    for (let lobe = 0; lobe < 3; lobe++) {
      const x = middle.x + (lobe - 1) * r * 0.32
      const y = middle.y + (lobe % 2 === 0 ? -1 : 1) * r * 0.18
      const size = r * (1 - lobe * 0.18)
      cloud.setShader(
        Skia.Shader.MakeRadialGradient(
          Skia.Point(x, y),
          size,
          [colorOf(skyRgba(color, lens === null ? 0.16 : 0.24)), colorOf(skyRgba(color, 0))],
          null,
          TileMode.Clamp,
        ),
      )
      canvas.drawCircle(x, y, size, cloud)
    }
  }

  // The stars, laid over each other as paint is rather than added up as light.
  // Close in, each opens into its cover, the most played first (`starLook`).
  const tile = tileSide(view.scale)
  const mx = field.width * MARGIN + tile
  const my = field.height * MARGIN + tile
  const a = toMap(view, base, { x: -mx, y: -my })
  const b = toMap(view, base, { x: field.width + mx, y: field.height + my })
  const near = pointsIn(grid, {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  })
  const litId = props.chosen ?? props.lit
  const lit = litId === null ? undefined : byId.get(litId)
  const litOpen = lit !== undefined && starLook(lit, view.scale).share > 0.5
  const shade = (point: SkyPoint): number => (litOpen && point !== lit ? SPOTLIGHT_DIM : 1)
  const shown: { point: SkyPoint; x: number; y: number; look: StarLook }[] = []
  for (const point of near) {
    const spot = at(point)
    const look = starLook(point, view.scale)
    const reach = glowReach(point, look.r, view.scale, base)
    const alpha = starAlpha(point, lens) * shade(point)
    const glow = glowOf(point.glow)
    if (glow) {
      paint.setColor(white)
      paint.setAlphaf(alpha)
      canvas.drawImageRect(
        glow,
        GLOW_SOURCE,
        Skia.XYWHRect(spot.x - reach, spot.y - reach, reach * 2, reach * 2),
        paint,
      )
    }
    if (look.star > 0.01) {
      if (point.flare) {
        flare(
          canvas,
          spot,
          flareReach(point, look.r, view.scale, base),
          point.core,
          alpha * look.star,
        )
      }
      paint.setColor(colorOf(point.core))
      paint.setAlphaf(alpha * look.star)
      canvas.drawCircle(spot.x, spot.y, look.r * CORE, paint)
    }
    if (look.cover > 0.01 && !(litOpen && point === lit)) {
      shown.push({ point, x: spot.x, y: spot.y, look })
    }
  }

  // The most played on top, each keeping its star's light (K1): a glow behind,
  // a rim, its plays as brightness, and a flared star's flare as a glint.
  shown.sort((p, q) => p.point.bright - q.point.bright)
  const rim = Skia.Paint()
  rim.setAntiAlias(true)
  rim.setStyle(PaintStyle.Stroke)
  rim.setStrokeWidth(1)
  for (const { point, x, y, look } of shown) {
    const song = songs.get(point.id)
    const dim = (lens !== null && !point.tagIds.includes(lens) ? 0.15 : 1) * shade(point)
    const { side, corner } = look
    const half = side / 2
    const glow = glowOf(point.glow)
    if (glow) {
      const halo = haloReach(point, side, view.scale, base)
      paint.setColor(white)
      paint.setAlphaf(0.5 * look.share * dim)
      canvas.drawImageRect(
        glow,
        GLOW_SOURCE,
        Skia.XYWHRect(x - halo, y - halo, halo * 2, halo * 2),
        paint,
      )
    }
    const face = Skia.XYWHRect(x - half, y - half, side, side)
    const box = Skia.RRectXY(face, corner, corner)
    const image = song ? cover(song) : null
    canvas.save()
    canvas.clipRRect(box, ClipOp.Intersect, true)
    if (image) {
      paint.setColor(white)
      paint.setAlphaf(look.cover * dim)
      canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), face, paint)
    } else {
      paint.setColor(colorOf(point.glow))
      paint.setAlphaf(look.cover * dim)
      canvas.drawRect(face, paint)
    }
    if (look.veil > 0) {
      paint.setColor(colorOf('#000000'))
      paint.setAlphaf(look.veil * look.cover * dim)
      canvas.drawRect(face, paint)
    }
    canvas.restore()
    rim.setColor(colorOf(point.core))
    rim.setAlphaf(look.cover * dim * 0.35)
    canvas.drawRRect(box, rim)
    if (point.flare) {
      const shine = glint(side)
      flare(canvas, { x: x + shine.dx, y: y + shine.dy }, shine.reach, point.core, look.share * dim)
      paint.setColor(colorOf(SKY_INK))
      paint.setAlphaf(look.share * dim)
      canvas.drawCircle(x + shine.dx, y + shine.dy, 1.6, paint)
    }
  }
  // Close enough, open covers wear their names where they have the room.
  if (tile >= NAMES_FROM) {
    const named = namedCovers(
      shown
        .filter(({ look }) => look.share > 0.9)
        .map(({ point, x, y, look }) => ({
          id: point.id,
          x,
          y,
          side: look.side,
          bright: point.bright,
        })),
    )
    for (const { point, x, y, look } of shown) {
      const song = songs.get(point.id)
      if (!song || !named.has(point.id)) continue
      const dim = (lens !== null && !point.tagIds.includes(lens) ? 0.15 : 1) * shade(point)
      const width = look.side + NAME_SPILL
      const name = nameOf(song.title, width, NAME_HEIGHT - 3, FontWeight.SemiBold, SKY_INK)
      canvas.saveLayer(alphaLayer(look.cover * dim * 0.92))
      name.paint(canvas, x - width / 2, y + look.side / 2 + NAME_GAP)
      canvas.restore()
    }
  }

  // What the tray holds: a line's stars joined as a constellation, a loop's outline.
  const line = Skia.Paint()
  line.setAntiAlias(true)
  line.setStyle(PaintStyle.Stroke)
  for (const take of takes) {
    const builder = Skia.PathBuilder.Make()
    if (take.kind === 'loop') {
      take.path.forEach((place, index) => {
        const spot = at(place)
        if (index === 0) builder.moveTo(spot.x, spot.y)
        else builder.lineTo(spot.x, spot.y)
      })
      const path = builder.close().detach()
      paint.setColor(colorOf(take.tone))
      paint.setAlphaf(0.07)
      canvas.drawPath(path, paint)
      line.setColor(colorOf(skyRgba(take.tone, 0.9)))
      line.setStrokeWidth(1.8)
      line.setPathEffect(Skia.PathEffect.MakeDash([6, 5], 0))
      canvas.drawPath(path, line)
      line.setPathEffect(null)
    } else {
      let first = true
      for (const id of take.chain) {
        const place = byId.get(id)
        if (!place) continue
        const spot = at(place)
        if (first) builder.moveTo(spot.x, spot.y)
        else builder.lineTo(spot.x, spot.y)
        first = false
      }
      line.setColor(colorOf(skyRgba(take.tone, 0.85)))
      line.setStrokeWidth(1.4)
      canvas.drawPath(builder.detach(), line)
    }
    for (const id of take.ids) {
      const place = byId.get(id)
      if (!place) continue
      const spot = at(place)
      paint.setColor(colorOf(SKY_INK))
      paint.setAlphaf(1)
      canvas.drawCircle(spot.x, spot.y, 2.2, paint)
      line.setColor(colorOf(skyRgba(take.tone, 0.55)))
      line.setStrokeWidth(1)
      canvas.drawCircle(spot.x, spot.y, ringRadius(place, view.scale, 5.5), line)
    }
  }

  // The playing song: the one star wearing its cover, ringed. Lit from the
  // tray, the spotlight is its look instead.
  const now = playing === null ? undefined : byId.get(playing)
  const nowSong = now ? songs.get(now.id) : undefined
  if (now && nowSong && !(litOpen && lit === now)) {
    const spot = at(now)
    const big = Math.max(22, starLook(now, view.scale).side * 1.15)
    paint.setColor(colorOf(accent))
    paint.setAlphaf(0.25)
    canvas.drawCircle(spot.x, spot.y, big * 1.05, paint)
    const face = Skia.XYWHRect(spot.x - big / 2, spot.y - big / 2, big, big)
    const box = Skia.RRectXY(face, big * 0.2, big * 0.2)
    const image = cover(nowSong)
    if (image) {
      paint.setColor(white)
      paint.setAlphaf(1)
      canvas.save()
      canvas.clipRRect(box, ClipOp.Intersect, true)
      canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), face, paint)
      canvas.restore()
    } else {
      paint.setColor(colorOf(now.glow))
      paint.setAlphaf(1)
      canvas.drawRRect(box, paint)
    }
    line.setColor(colorOf(SKY_INK))
    line.setStrokeWidth(1.5)
    canvas.drawRRect(box, line)
  }

  // The song pressed in the tray's list, while it is still a star: ringed.
  if (lit && !litOpen) {
    const spot = at(lit)
    line.setColor(colorOf(SKY_INK))
    line.setStrokeWidth(1.5)
    canvas.drawCircle(spot.x, spot.y, ringRadius(lit, view.scale, 7), line)
  }
}

/** A layer that lays what is drawn into it down at `alpha`. */
function alphaLayer(alpha: number): SkPaint {
  const layer = Skia.Paint()
  layer.setAlphaf(alpha)
  return layer
}

/**
 * A bright star's four-pointed flare: two thin strokes through it, brightest
 * at the star and fading to nothing at their ends.
 */
function flare(
  canvas: SkCanvas,
  spot: { x: number; y: number },
  reach: number,
  color: string,
  alpha: number,
): void {
  const stroke = Skia.Paint()
  stroke.setAntiAlias(true)
  stroke.setStyle(PaintStyle.Stroke)
  stroke.setStrokeWidth(0.8)
  stroke.setAlphaf(alpha)
  const colors = [
    colorOf(skyRgba(color, 0)),
    colorOf(skyRgba(color, 0.9)),
    colorOf(skyRgba(color, 0)),
  ]
  for (const [dx, dy] of [
    [reach, 0],
    [0, reach],
  ] as const) {
    stroke.setShader(
      Skia.Shader.MakeLinearGradient(
        Skia.Point(spot.x - dx, spot.y - dy),
        Skia.Point(spot.x + dx, spot.y + dy),
        colors,
        [0, 0.5, 1],
        TileMode.Clamp,
      ),
    )
    canvas.drawLine(spot.x - dx, spot.y - dy, spot.x + dx, spot.y + dy, stroke)
  }
}

/** How wide the lit song's name may run under it. */
const SPOT_WORDS = 240

/**
 * What is over the sky and changes while it holds still: the stroke under the
 * finger, the pressed spot, and the song pressed in the tray's list once its
 * cover is open, lit over the veil that dims the sky (H3): a little larger,
 * in a glow of its own colour, its title and artist under it, kept short of
 * the tray's panel.
 */
function paintOver(
  canvas: SkCanvas,
  {
    stroke,
    pulse,
    accent,
    field,
    panel,
    base,
  }: Pick<SkyLayerProps, 'stroke' | 'pulse' | 'field' | 'panel' | 'base'> & { accent: string },
  view: MapView,
  lit: { place: SkyPoint | undefined; song: Song | undefined; image: SkImage | null },
): void {
  const paint = Skia.Paint()
  paint.setAntiAlias(true)
  if (lit.place && lit.song) {
    const look = starLook(lit.place, view.scale)
    const spot = toScreen(view, base, lit.place)
    const side = spotlightSide(look.side)
    const half = side / 2
    const radius = look.corner * (side / look.side)
    // The glow is cast by a shape a little inside the cover, so none of its
    // pale fill is left at the cover's soft edge as a light outline.
    const glow = Skia.Paint()
    glow.setAntiAlias(true)
    glow.setColor(colorOf(lit.place.glow))
    glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 11, true))
    const inner = Math.max(0, radius - SPOTLIGHT_INSET)
    canvas.drawRRect(
      Skia.RRectXY(
        Skia.XYWHRect(
          spot.x - half + SPOTLIGHT_INSET,
          spot.y - half + SPOTLIGHT_INSET,
          side - SPOTLIGHT_INSET * 2,
          side - SPOTLIGHT_INSET * 2,
        ),
        inner,
        inner,
      ),
      glow,
    )
    const face = Skia.XYWHRect(spot.x - half, spot.y - half, side, side)
    const box = Skia.RRectXY(face, radius, radius)
    if (lit.image) {
      canvas.save()
      canvas.clipRRect(box, ClipOp.Intersect, true)
      canvas.drawImageRect(
        lit.image,
        Skia.XYWHRect(0, 0, lit.image.width(), lit.image.height()),
        face,
        paint,
      )
      canvas.restore()
    } else {
      paint.setColor(colorOf(lit.place.glow))
      canvas.drawRRect(box, paint)
    }
    const middle = Math.min(spot.x, field.width - panel - SPOT_WORDS / 2 - 8)
    const title = nameOf(lit.song.title, SPOT_WORDS, 15, FontWeight.SemiBold, SKY_INK, true)
    title.paint(canvas, middle - SPOT_WORDS / 2, spot.y + half + 6)
    const artist = nameOf(
      lit.song.artist,
      SPOT_WORDS,
      13,
      FontWeight.Normal,
      'rgba(244,245,249,0.72)',
    )
    artist.paint(canvas, middle - SPOT_WORDS / 2, spot.y + half + 6 + title.getHeight())
  }
  if (stroke.length > 1) {
    const builder = Skia.PathBuilder.Make()
    stroke.forEach((place, index) => {
      const spot = toScreen(view, base, place)
      if (index === 0) builder.moveTo(spot.x, spot.y)
      else builder.lineTo(spot.x, spot.y)
    })
    const path = builder.detach()
    const line = Skia.Paint()
    line.setAntiAlias(true)
    line.setStyle(PaintStyle.Stroke)
    line.setStrokeWidth(3)
    line.setStrokeCap(StrokeCap.Round)
    line.setStrokeJoin(StrokeJoin.Round)
    line.setColor(colorOf(skyRgba(accent, 0.95)))
    line.setPathEffect(Skia.PathEffect.MakeDash([2, 7], 0))
    canvas.drawPath(path, line)
  }
  if (pulse) {
    paint.setColor(colorOf(skyRgba(accent, 0.35)))
    canvas.drawCircle(pulse.x, pulse.y, 16, paint)
  }
}
