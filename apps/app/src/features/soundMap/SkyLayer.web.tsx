import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { View } from 'react-native'
import { useUnistyles } from 'react-native-unistyles'
import { useFocusEffect } from 'expo-router'
import type { MapPlace, Song } from '@selfmp3/shared'
import { tagColors } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { useMotionReduced } from '../../ui/motion'
import { useFieldPointer } from './fieldInput'
import {
  CORE,
  DEEP_LAYERS,
  deepBeat,
  deepPlaces,
  deepStars,
  deepTwinkle,
  dustSpecks,
  flareReach,
  glint,
  glowReach,
  GLOW_STOPS,
  haloReach,
  NAME_GAP,
  NAME_SPILL,
  NAMES_FROM,
  namedCovers,
  pointsIn,
  ringRadius,
  SKY_EDGE,
  SKY_INK,
  SKY_TOP,
  songUnder,
  starAlpha,
  starLook,
  skyGrid,
  type DeepStar,
  type SkyGrid,
  type SkyLayerProps,
  type SkyPoint,
  type StarLook,
} from './sky.model'
import {
  tileSide,
  toMap,
  toScreen,
  type FieldSize,
  type LiveView,
  type MapView,
} from './soundMapView.model'

/**
 * The sound map's sky in a browser and the desktop app: one canvas for the
 * songs, drawn again at most once a frame while the map moves, and not at all
 * while it holds still, over one for the ground and the deep sky (`DeepSky`),
 * which twinkles on its own.
 *
 * One canvas rather than an element a song. The page this replaced drew 1,500
 * views and moved each one, and every place a view was moved to became a new
 * CSS rule (react-native-unistyles turns each distinct style into one); a few
 * minutes of zooming filled Chrome's memory until the tab died. Here nothing
 * a song is drawn with is a style, and the only things kept are a glow per
 * colour and the covers on screen. A frame looks only at the songs on screen
 * (`skyGrid`), so a library many times larger costs a frame no more where it
 * is not in view.
 */
export function SkyLayer(props: SkyLayerProps & { pointerRef: RefObject<View | null> }): ReactNode {
  const { field, pointerRef } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const art = useArt(128)
  const accent = useUnistyles().theme.colors.accent
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  useFieldPointer(pointerRef, setHover)
  // A song the keys choose is newer than a pointer resting on the field, over
  // which the map slides to follow it: the pointer names a star again once it moves.
  const [chosenWas, setChosenWas] = useState(props.chosen)
  if (props.chosen !== chosenWas) {
    setChosenWas(props.chosen)
    if (props.chosen != null) setHover(null)
  }
  const byId = useMemo(() => new Map(props.points.map(point => [point.id, point])), [props.points])
  const grid = useMemo(() => skyGrid(props.points), [props.points])

  const latest = useRef({ props, hover, art, byId, grid, accent })
  const frame = useRef<number | null>(null)
  // A cover that arrives asks for the sky to be drawn again.
  const again = useRef(() => {})
  // A frame to draw, at most one a frame: asked for by every render, with the
  // newest props kept for it, and by every frame of a move, which reads where
  // the map is from `live` without a render.
  const paint = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const { props: now, hover: pointer, art: artOf, byId: placed, grid: cells } = latest.current
      const addresses = addressesOf(artOf)
      coverFrame++
      coverLoads = 0
      draw(
        ctx,
        canvas,
        now,
        now.live.now(),
        placed,
        cells,
        latest.current.accent,
        pointer,
        song => {
          // Worked out once a song and kept until the covers change, not every
          // frame for every cover on screen.
          let uri = addresses.get(song.id)
          if (uri === undefined && !addresses.has(song.id)) {
            uri = artOf(song)
            addresses.set(song.id, uri)
          }
          return coverImage(uri, () => again.current())
        },
      )
    })
  }, [])
  useLayoutEffect(() => {
    latest.current = { props, hover, art, byId, grid, accent }
    again.current = paint
    paint()
  })
  useEffect(() => props.live.watch(paint), [props.live, paint])
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )
  return (
    <>
      <DeepSky field={field} live={props.live} still={props.still ?? false} />
      <canvas ref={canvasRef} aria-hidden="true" style={FILL} />
    </>
  )
}

const FILL = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
} as const

/** The deep sky is drawn again this often while it twinkles and the map holds still. */
const TWINKLE_FRAME_MS = 40

/**
 * The ground behind the songs: the night, its dust, and the deep sky (K3),
 * faint stars that are not songs, drifting a little as the map moves and
 * twinkling. On a canvas of its own, so a twinkle never draws the songs again.
 * Under Reduce Motion, still as on Home's card, or under another page (which
 * leaves the map mounted), it does not twinkle.
 */
function DeepSky({
  field,
  live,
  still,
}: {
  field: FieldSize
  live: LiveView
  still: boolean
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ground = useGround(field)
  const reduced = useMotionReduced()
  const [focused, setFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, []),
  )
  const layers = useMemo(() => (still ? [] : deepStars()), [still])
  const latest = useRef({ ground })
  const wake = useRef<(() => void) | null>(null)
  useEffect(() => {
    const twinkle = !still && !reduced && focused
    let frame: number | null = null
    let drawn: { view: MapView | null; ground: HTMLCanvasElement | null; at: number } = {
      view: null,
      ground: null,
      at: -Infinity,
    }
    const tick = (now: number): void => {
      frame = twinkle ? requestAnimationFrame(tick) : null
      const at = live.now()
      const { ground: back } = latest.current
      const changed = at !== drawn.view || back !== drawn.ground
      if (!changed && (!twinkle || now - drawn.at < TWINKLE_FRAME_MS)) return
      drawn = { view: at, ground: back, at: now }
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx) paintDeep(ctx, canvas, field, back, layers, at, twinkle ? now : null)
    }
    frame = requestAnimationFrame(tick)
    wake.current = () => {
      if (frame === null) frame = requestAnimationFrame(tick)
    }
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      wake.current = null
    }
  }, [field, focused, layers, live, reduced, still])
  useLayoutEffect(() => {
    latest.current = { ground }
    wake.current?.()
  })
  useEffect(() => live.watch(() => wake.current?.()), [live])
  return <canvas ref={canvasRef} aria-hidden="true" style={FILL} />
}

function paintDeep(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  field: FieldSize,
  ground: HTMLCanvasElement | null,
  layers: readonly (readonly DeepStar[])[],
  view: MapView,
  ms: number | null,
): void {
  const dpr = dprOf()
  if (
    canvas.width !== Math.round(field.width * dpr) ||
    canvas.height !== Math.round(field.height * dpr)
  ) {
    canvas.width = Math.round(field.width * dpr)
    canvas.height = Math.round(field.height * dpr)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (ground) ctx.drawImage(ground, 0, 0)
  else ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  layers.forEach((stars, layer) => {
    for (const { star, x, y, size } of deepPlaces(
      stars,
      DEEP_LAYERS[layer]!.parallax,
      view,
      field,
    )) {
      ctx.globalAlpha = ms === null ? star.opacity : deepTwinkle(star, deepBeat(star.beat, ms))
      ctx.fillStyle = star.tint
      ctx.beginPath()
      ctx.arc(x, y, size / 2, 0, Math.PI * 2)
      ctx.fill()
    }
  })
  ctx.globalAlpha = 1
}

/** Density is capped at two: a third would treble the pixels for nothing a star shows. */
const dprOf = (): number => Math.min(2, window.devicePixelRatio || 1)

/**
 * The night ground and its dust, painted once for the field's size into a
 * canvas of its own, then copied in each frame.
 */
function useGround(field: FieldSize): HTMLCanvasElement | null {
  return useMemo(() => {
    if (typeof document === 'undefined' || field.width < 1 || field.height < 1) return null
    const dpr = dprOf()
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(field.width * dpr)
    canvas.height = Math.round(field.height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(dpr, dpr)
    const { width, height } = field
    const sky = ctx.createRadialGradient(
      width / 2,
      height * 0.45,
      0,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.8,
    )
    sky.addColorStop(0, SKY_TOP)
    sky.addColorStop(1, SKY_EDGE)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#c8d2ff'
    for (const speck of dustSpecks(field, Infinity)) {
      ctx.globalAlpha = speck.opacity
      ctx.fillRect(speck.x, speck.y, speck.side, speck.side)
    }
    ctx.globalAlpha = 1
    return canvas
  }, [field])
}

/** One glow a colour: a small picture of the falloff, drawn at each star's size. */
const glows = new Map<string, HTMLCanvasElement>()
const GLOW_SIDE = 64

function glowOf(glow: string): HTMLCanvasElement {
  const key = glow
  const kept = glows.get(key)
  if (kept) return kept
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = GLOW_SIDE
  const ctx = canvas.getContext('2d')!
  const half = GLOW_SIDE / 2
  const fill = ctx.createRadialGradient(half, half, 0, half, half, half)
  for (const [offset, opacity] of GLOW_STOPS) fill.addColorStop(offset, withAlpha(glow, opacity))
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, GLOW_SIDE, GLOW_SIDE)
  glows.set(key, canvas)
  return canvas
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1, 7), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/**
 * The covers asked for, by address, the most recent last: about this many
 * kept, the oldest let go, but never one drawn in the frame being drawn. A
 * screenful of covers at the closest zoom is about sixty, so this holds a few
 * screens of looking about; further out, a crowd of a few thousand small
 * covers is all kept while it is on screen. (Until 2026-10-31 the cap held
 * whatever was on screen too: past 240 covers in view, each frame let go of
 * covers it then asked for again, and a large library moved at a few frames
 * a second.)
 */
const COVERS_KEPT = 240
/** At most this many covers start loading a frame, so a zoom into a crowd does not ask for them all at once. */
const COVER_LOADS_A_FRAME = 24
const coverCache = new Map<string, { image: HTMLImageElement; frame: number }>()
let coverFrame = 0
let coverLoads = 0

function coverImage(uri: string | null | undefined, arrived: () => void): HTMLImageElement | null {
  if (!uri) return null
  const kept = coverCache.get(uri)
  if (kept) {
    coverCache.delete(uri)
    kept.frame = coverFrame
    coverCache.set(uri, kept)
    return kept.image.complete && kept.image.naturalWidth > 0 ? kept.image : null
  }
  if (coverLoads >= COVER_LOADS_A_FRAME) return null
  coverLoads++
  const image = new window.Image()
  image.decoding = 'async'
  image.addEventListener('load', arrived, { once: true })
  image.src = uri
  coverCache.set(uri, { image, frame: coverFrame })
  for (const [oldest, entry] of coverCache) {
    if (coverCache.size <= COVERS_KEPT || entry.frame === coverFrame) break
    coverCache.delete(oldest)
  }
  return null
}

/** Each song's cover address, worked out once for as long as `art` is the same. */
const addressBooks = new WeakMap<object, Map<number, string | null | undefined>>()
function addressesOf(art: object): Map<number, string | null | undefined> {
  let book = addressBooks.get(art)
  if (!book) {
    book = new Map()
    addressBooks.set(art, book)
  }
  return book
}

/**
 * A bright star's four-pointed flare: two thin strokes through it, brightest
 * at the star and fading to nothing at their ends.
 */
function flare(
  ctx: CanvasRenderingContext2D,
  spot: { x: number; y: number },
  reach: number,
  color: string,
): void {
  ctx.lineWidth = 0.8
  for (const [dx, dy] of [
    [reach, 0],
    [0, reach],
  ] as const) {
    const stroke = ctx.createLinearGradient(spot.x - dx, spot.y - dy, spot.x + dx, spot.y + dy)
    stroke.addColorStop(0, withAlpha(color, 0))
    stroke.addColorStop(0.5, withAlpha(color, 0.9))
    stroke.addColorStop(1, withAlpha(color, 0))
    ctx.strokeStyle = stroke
    ctx.beginPath()
    ctx.moveTo(spot.x - dx, spot.y - dy)
    ctx.lineTo(spot.x + dx, spot.y + dy)
    ctx.stroke()
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  side: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.roundRect(x, y, side, side, r)
}

function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  props: SkyLayerProps,
  view: MapView,
  byId: ReadonlyMap<number, SkyPoint>,
  grid: SkyGrid,
  accent: string,
  pointer: { x: number; y: number } | null,
  cover: (song: Song) => HTMLImageElement | null,
): void {
  const { field, base, regions, lens, takes, stroke, playing, lit, panel } = props
  const { pulse, songs } = props
  const { width, height } = field
  const dpr = dprOf()
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const at = (place: MapPlace): { x: number; y: number } => toScreen(view, base, place)

  // The nebulae: each tag's region, a soft cloud in its colour, a little off round.
  ctx.globalCompositeOperation = 'lighter'
  for (const region of regions) {
    const middle = at(region)
    const r = region.r * base * view.scale * 1.7
    const color = tagColors(region.hue, 'dark').dot
    for (let lobe = 0; lobe < 3; lobe++) {
      const dx = (lobe - 1) * r * 0.32
      const dy = (lobe % 2 === 0 ? -1 : 1) * r * 0.18
      const size = r * (1 - lobe * 0.18)
      const cloud = ctx.createRadialGradient(
        middle.x + dx,
        middle.y + dy,
        0,
        middle.x + dx,
        middle.y + dy,
        size,
      )
      cloud.addColorStop(0, withAlpha(color, lens === null ? 0.16 : 0.24))
      cloud.addColorStop(1, withAlpha(color, 0))
      ctx.fillStyle = cloud
      ctx.fillRect(middle.x + dx - size, middle.y + dy - size, size * 2, size * 2)
    }
  }
  ctx.globalCompositeOperation = 'source-over'

  // The stars, laid over each other as paint is rather than added up as light: added,
  // a place of a few hundred songs summed to one white blur. Close in, each
  // opens into its cover, the most played first (`starLook`).
  const tile = tileSide(view.scale)
  // Past the field's edge by as far as a glow or a flare reaches in.
  const margin = tile + 72
  const near = (x0: number, y0: number, x1: number, y1: number): SkyPoint[] => {
    const a = toMap(view, base, { x: x0, y: y0 })
    const b = toMap(view, base, { x: x1, y: y1 })
    return pointsIn(grid, {
      x0: Math.min(a.x, b.x),
      y0: Math.min(a.y, b.y),
      x1: Math.max(a.x, b.x),
      y1: Math.max(a.y, b.y),
    })
  }
  // The star under the pointer, named before it is pressed; else the song the
  // keys chose; else the one the pointer is on in the tray's list (a song lit
  // there lets go of the keys' one, so the newer of those two is named).
  // Once its cover is open it is lit and the rest of the sky dims round it (H3).
  const reachUnder = Math.max(14, tile / 2 + 4)
  const chosen = props.chosen == null ? null : (byId.get(props.chosen) ?? null)
  const under =
    (pointer
      ? songUnder(
          near(
            pointer.x - reachUnder,
            pointer.y - reachUnder,
            pointer.x + reachUnder,
            pointer.y + reachUnder,
          ),
          at,
          pointer,
          reachUnder,
        )
      : null) ??
    chosen ??
    (lit === null ? null : (byId.get(lit) ?? null))
  const underOpen = under !== null && starLook(under, view.scale).share > 0.5
  const shade = (point: SkyPoint): number => (underOpen && point !== under ? SPOTLIGHT_DIM : 1)
  const shown: { point: SkyPoint; x: number; y: number; look: StarLook }[] = []
  const dotPaths = new Map<string, Path2D>()
  for (const point of near(-margin, -margin, width + margin, height + margin)) {
    const spot = at(point)
    const look = starLook(point, view.scale)
    const reach = glowReach(point, look.r, view.scale, base)
    const alpha = starAlpha(point, lens) * shade(point)
    ctx.globalAlpha = alpha
    ctx.drawImage(glowOf(point.glow), spot.x - reach, spot.y - reach, reach * 2, reach * 2)
    if (look.star > 0.01) {
      ctx.globalAlpha = alpha * look.star
      if (point.flare) flare(ctx, spot, flareReach(point, look.r, view.scale, base), point.core)
      // Over all the glows, one path a colour and step of brightness rather
      // than a fill a star: a whole library in view is thousands of stars.
      const key = `${point.core} ${Math.max(1, Math.round(alpha * look.star * DOT_STEPS))}`
      let dots = dotPaths.get(key)
      if (!dots) {
        dots = new Path2D()
        dotPaths.set(key, dots)
      }
      const r = look.r * CORE
      dots.moveTo(spot.x + r, spot.y)
      dots.arc(spot.x, spot.y, r, 0, Math.PI * 2)
    }
    // The lit cover is drawn last, over everything, by `spotlight`.
    if (look.cover > 0.01 && !(underOpen && point === under)) {
      shown.push({ point, x: spot.x, y: spot.y, look })
    }
  }
  for (const [key, dots] of dotPaths) {
    const [core, steps] = key.split(' ')
    ctx.globalAlpha = Number(steps) / DOT_STEPS
    ctx.fillStyle = core!
    ctx.fill(dots)
  }
  // The most played on top.
  shown.sort((a, b) => a.point.bright - b.point.bright)
  // Close enough, open covers wear their names where they have the room.
  const named =
    tile >= NAMES_FROM
      ? namedCovers(
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
      : null
  for (const { point, x, y, look } of shown) {
    const song = songs.get(point.id)
    const dim = (lens !== null && !point.tagIds.includes(lens) ? 0.15 : 1) * shade(point)
    const { side, corner } = look
    const half = side / 2
    // A cover keeps its star's light (K1): a glow behind it, a rim, its plays
    // as brightness, and a flared star's flare as a glint on its corner.
    const halo = haloReach(point, side, view.scale, base)
    ctx.globalAlpha = 0.5 * look.share * dim
    ctx.drawImage(glowOf(point.glow), x - halo, y - halo, halo * 2, halo * 2)
    ctx.globalAlpha = look.cover * dim
    ctx.beginPath()
    ctx.roundRect(x - half, y - half, side, side, corner)
    const image = song ? cover(song) : null
    ctx.save()
    ctx.clip()
    if (image) ctx.drawImage(image, x - half, y - half, side, side)
    else {
      ctx.fillStyle = point.glow
      ctx.fillRect(x - half, y - half, side, side)
    }
    if (look.veil > 0) {
      ctx.fillStyle = `rgba(0,0,0,${look.veil})`
      ctx.fillRect(x - half, y - half, side, side)
    }
    ctx.restore()
    ctx.globalAlpha = look.cover * dim * 0.35
    ctx.strokeStyle = point.core
    ctx.lineWidth = 1
    ctx.stroke()
    if (point.flare) {
      const shine = glint(side)
      ctx.globalAlpha = look.share * dim
      flare(ctx, { x: x + shine.dx, y: y + shine.dy }, shine.reach, point.core)
      ctx.fillStyle = SKY_INK
      ctx.beginPath()
      ctx.arc(x + shine.dx, y + shine.dy, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  if (named && named.size > 0) {
    ctx.fillStyle = SKY_INK
    ctx.font = `600 10px ${FONT}`
    ctx.textAlign = 'center'
    for (const { point, x, y, look } of shown) {
      const song = songs.get(point.id)
      if (!song || !named.has(point.id)) continue
      const dim = (lens !== null && !point.tagIds.includes(lens) ? 0.15 : 1) * shade(point)
      ctx.globalAlpha = look.cover * dim * 0.92
      ctx.fillText(
        fitText(ctx, song.title, look.side + NAME_SPILL),
        x,
        y + look.side / 2 + NAME_GAP + 9,
      )
    }
  }
  ctx.globalAlpha = 1

  // What the tray holds: a line's stars joined as a constellation, a loop's outline.
  for (const take of takes) {
    if (take.kind === 'loop') {
      ctx.beginPath()
      take.path.forEach((place, index) => {
        const spot = at(place)
        if (index === 0) ctx.moveTo(spot.x, spot.y)
        else ctx.lineTo(spot.x, spot.y)
      })
      ctx.closePath()
      ctx.fillStyle = withAlpha(take.tone, 0.07)
      ctx.fill()
      ctx.setLineDash([6, 5])
      ctx.strokeStyle = withAlpha(take.tone, 0.9)
      ctx.lineWidth = 1.8
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      ctx.beginPath()
      let first = true
      for (const id of take.chain) {
        const place = byId.get(id)
        if (!place) continue
        const spot = at(place)
        if (first) ctx.moveTo(spot.x, spot.y)
        else ctx.lineTo(spot.x, spot.y)
        first = false
      }
      ctx.strokeStyle = withAlpha(take.tone, 0.85)
      ctx.lineWidth = 1.4
      ctx.stroke()
    }
    for (const id of take.ids) {
      const place = byId.get(id)
      if (!place) continue
      const spot = at(place)
      ctx.fillStyle = SKY_INK
      ctx.beginPath()
      ctx.arc(spot.x, spot.y, 2.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = withAlpha(take.tone, 0.55)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(spot.x, spot.y, ringRadius(place, view.scale, 5.5), 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // The stroke under the finger.
  if (stroke.length > 1) {
    ctx.beginPath()
    stroke.forEach((place, index) => {
      const spot = at(place)
      if (index === 0) ctx.moveTo(spot.x, spot.y)
      else ctx.lineTo(spot.x, spot.y)
    })
    ctx.setLineDash([2, 7])
    ctx.lineCap = 'round'
    ctx.strokeStyle = withAlpha(accent, 0.95)
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.setLineDash([])
  }

  // The playing song: the one star wearing its cover. Lit by the pointer, the
  // spotlight is its look instead: the two together left the playing ring's
  // disc and white edge showing round the lit cover.
  const now = playing === null ? undefined : byId.get(playing)
  const nowSong = now ? songs.get(now.id) : undefined
  if (now && nowSong && !(underOpen && under === now)) {
    const spot = at(now)
    const big = Math.max(22, starLook(now, view.scale).side * 1.15)
    ctx.fillStyle = withAlpha(accent, 0.25)
    ctx.beginPath()
    ctx.arc(spot.x, spot.y, big * 1.05, 0, Math.PI * 2)
    ctx.fill()
    roundRect(ctx, spot.x - big / 2, spot.y - big / 2, big, big * 0.2)
    const image = cover(nowSong)
    if (image) {
      ctx.save()
      ctx.clip()
      ctx.drawImage(image, spot.x - big / 2, spot.y - big / 2, big, big)
      ctx.restore()
    } else {
      ctx.fillStyle = now.glow
      ctx.fill()
    }
    ctx.strokeStyle = SKY_INK
    ctx.lineWidth = 1.5
    roundRect(ctx, spot.x - big / 2, spot.y - big / 2, big, big * 0.2)
    ctx.stroke()
  }

  if (pulse) {
    ctx.fillStyle = withAlpha(accent, 0.35)
    ctx.beginPath()
    ctx.arc(pulse.x, pulse.y, 16, 0, Math.PI * 2)
    ctx.fill()
  }

  // The song pointed at. Once its cover is open, it is the one lit thing on a
  // dimmed sky, its name under it (H3); while it is still a star, the star is
  // ringed and named beside it.
  const song = under ? songs.get(under.id) : undefined
  if (under && song && underOpen) {
    spotlight(
      ctx,
      song,
      under,
      at(under),
      starLook(under, view.scale),
      cover(song),
      field.width - panel,
    )
  } else if (under && song) {
    const spot = at(under)
    ctx.strokeStyle = SKY_INK
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(spot.x, spot.y, ringRadius(under, view.scale, 7), 0, Math.PI * 2)
    ctx.stroke()
    tooltip(ctx, song, spot, Math.max(14, starLook(under, view.scale).side / 2 + 8), field)
  }

  // The keys' song wears the focus ring, in the accent, as anything the
  // keyboard is on does: drawn on its own, so the pointer over another star
  // names that one and the ring stays where the keys are.
  if (chosen) {
    const spot = at(chosen)
    const look = starLook(chosen, view.scale)
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.beginPath()
    if (look.share > 0.5) {
      // Just outside its cover, spotlit (and so larger) when it is the one named.
      const side =
        (chosen === under ? Math.max(SPOTLIGHT_COVER, look.side * 1.15) : look.side) + FOCUS_GAP * 2
      ctx.roundRect(
        spot.x - side / 2,
        spot.y - side / 2,
        side,
        side,
        look.corner * (side / look.side),
      )
    } else {
      ctx.arc(spot.x, spot.y, ringRadius(chosen, view.scale, 7), 0, Math.PI * 2)
    }
    ctx.stroke()
  }
}

/**
 * A cover pointed at, close in (H3): the rest of the sky has dimmed
 * (`SPOTLIGHT_DIM`), and this one is lifted a little in a glow of its own
 * colour, its title and artist under it, larger than a cover's own small
 * name, kept short of the tray's panel (`clear`).
 */
function spotlight(
  ctx: CanvasRenderingContext2D,
  song: Song,
  point: SkyPoint,
  spot: { x: number; y: number },
  look: StarLook,
  image: HTMLImageElement | null,
  clear: number,
): void {
  const side = Math.max(SPOTLIGHT_COVER, look.side * 1.15)
  const half = side / 2
  const halo = side * 1.6
  ctx.globalAlpha = 0.9
  ctx.drawImage(glowOf(point.glow), spot.x - halo, spot.y - halo, halo * 2, halo * 2)
  ctx.globalAlpha = 1
  const corner = look.corner * (side / look.side)
  // The glow is cast by a shape a little inside the cover, so none of its pale
  // fill is left at the cover's soft edge as a light outline (2026-10-26).
  const inset = image ? SPOTLIGHT_INSET : 0
  ctx.save()
  ctx.shadowColor = withAlpha(point.glow, 0.6)
  ctx.shadowBlur = 22
  ctx.beginPath()
  ctx.roundRect(
    spot.x - half + inset,
    spot.y - half + inset,
    side - inset * 2,
    side - inset * 2,
    Math.max(0, corner - inset),
  )
  ctx.fillStyle = point.glow
  ctx.fill()
  ctx.restore()
  if (image) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(spot.x - half, spot.y - half, side, side, corner)
    ctx.clip()
    ctx.drawImage(image, spot.x - half, spot.y - half, side, side)
    ctx.restore()
  }
  ctx.textAlign = 'center'
  ctx.font = `600 13px ${FONT}`
  const title = fitText(ctx, song.title, 220)
  ctx.font = `400 12px ${FONT}`
  const line = fitText(ctx, song.artist, 220)
  const words = Math.max(ctx.measureText(title).width, ctx.measureText(line).width)
  const x = Math.min(spot.x, clear - words / 2 - 8)
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowBlur = 6
  ctx.fillStyle = SKY_INK
  ctx.font = `600 13px ${FONT}`
  ctx.fillText(title, x, spot.y + half + 18)
  ctx.fillStyle = 'rgba(244,245,249,0.72)'
  ctx.font = `400 12px ${FONT}`
  ctx.fillText(line, x, spot.y + half + 34)
  ctx.restore()
}

/** A star's dot is drawn at one of this many steps of brightness. */
const DOT_STEPS = 12

/** How bright the rest of the sky stays while a cover is lit. */
const SPOTLIGHT_DIM = 0.3
/** The lit cover is at least this wide. */
const SPOTLIGHT_COVER = 52
/** How far inside a lit cover's edge its glow is cast from. */
const SPOTLIGHT_INSET = 2
/** How far outside the keys' lit cover its focus ring is drawn. */
const FOCUS_GAP = 3

const FONT = '-apple-system, system-ui, "PingFang SC", "Hiragino Sans", sans-serif'

/**
 * Text cut to a width with an ellipsis, kept by font, width and text: cutting
 * measures the text once a letter, and the same names are drawn every frame.
 */
const fitted = new Map<string, string>()
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  const key = `${ctx.font}\u0000${Math.round(width)}\u0000${text}`
  const kept = fitted.get(key)
  if (kept !== undefined) return kept
  let cut = text
  if (ctx.measureText(text).width > width) {
    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1)
    cut = `${cut}…`
  }
  if (fitted.size > 4000) fitted.clear()
  fitted.set(key, cut)
  return cut
}

/** The title and artist in a small dark card beside the star (`gap` clear of it), kept inside the field. */
function tooltip(
  ctx: CanvasRenderingContext2D,
  song: Song,
  spot: { x: number; y: number },
  gap: number,
  field: FieldSize,
): void {
  ctx.textAlign = 'left'
  ctx.font = `600 12px ${FONT}`
  const title = fitText(ctx, song.title, 220)
  const titleWidth = ctx.measureText(title).width
  ctx.font = `400 11px ${FONT}`
  const line = fitText(ctx, song.artist, 220)
  const width = Math.max(titleWidth, ctx.measureText(line).width) + 20
  const height = 40
  const x = spot.x + gap + width + 8 > field.width ? spot.x - gap - width : spot.x + gap
  const y = Math.max(8, Math.min(field.height - height - 8, spot.y - height / 2))
  ctx.fillStyle = 'rgba(31,34,44,0.92)'
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, 10)
  ctx.fill()
  ctx.fillStyle = SKY_INK
  ctx.font = `600 12px ${FONT}`
  ctx.fillText(title, x + 10, y + 17)
  ctx.fillStyle = 'rgba(244,245,249,0.68)'
  ctx.font = `400 11px ${FONT}`
  ctx.fillText(line, x + 10, y + 32)
}
