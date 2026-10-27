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
  ringRadius,
  SKY_EDGE,
  SKY_INK,
  SKY_TOP,
  songUnder,
  starAlpha,
  starLook,
  type DeepStar,
  type SkyLayerProps,
  type SkyPoint,
  type StarLook,
} from './sky.model'
import { tileSide, toScreen, type FieldSize, type MapView } from './soundMapView.model'

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
 * colour and the few covers on screen.
 */
export function SkyLayer(props: SkyLayerProps & { pointerRef: RefObject<View | null> }): ReactNode {
  const { field, pointerRef } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const art = useArt(128)
  const accent = useUnistyles().theme.colors.accent
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  // A cover that arrives asks for the sky to be drawn again.
  const [covers, setCovers] = useState(0)
  useFieldPointer(pointerRef, setHover)
  const byId = useMemo(() => new Map(props.points.map(point => [point.id, point])), [props.points])

  const latest = useRef({ props, hover, art, byId, accent })
  const frame = useRef<number | null>(null)
  // Every render is a frame to draw: the newest props are kept for it, and
  // several renders before the next frame draw once.
  useLayoutEffect(() => {
    latest.current = { props, hover, art, byId, accent }
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const { props: now, hover: pointer, art: artOf, byId: placed, accent: ink } = latest.current
      draw(ctx, canvas, now, placed, ink, pointer, song =>
        coverImage(artOf(song), () => setCovers(n => n + 1)),
      )
    })
  })
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )
  void covers

  return (
    <>
      <DeepSky field={field} view={props.view} still={props.still ?? false} />
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
  view,
  still,
}: {
  field: FieldSize
  view: MapView
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
  const latest = useRef({ view, ground })
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
      const { view: at, ground: back } = latest.current
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
  }, [field, focused, layers, reduced, still])
  useLayoutEffect(() => {
    latest.current = { view, ground }
    wake.current?.()
  })
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
 * The covers asked for, by address, the most recent last: at most this many
 * kept, the oldest let go. A screenful of covers at the closest zoom is about
 * sixty, so this holds a few screens of looking about.
 */
const COVERS_KEPT = 240
const coverCache = new Map<string, HTMLImageElement>()

function coverImage(uri: string | null | undefined, arrived: () => void): HTMLImageElement | null {
  if (!uri) return null
  const kept = coverCache.get(uri)
  if (kept) {
    coverCache.delete(uri)
    coverCache.set(uri, kept)
    return kept.complete && kept.naturalWidth > 0 ? kept : null
  }
  const image = new window.Image()
  image.decoding = 'async'
  image.addEventListener('load', arrived, { once: true })
  image.src = uri
  coverCache.set(uri, image)
  if (coverCache.size > COVERS_KEPT) {
    const oldest = coverCache.keys().next().value
    if (oldest !== undefined) coverCache.delete(oldest)
  }
  return null
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
  byId: ReadonlyMap<number, SkyPoint>,
  accent: string,
  pointer: { x: number; y: number } | null,
  cover: (song: Song) => HTMLImageElement | null,
): void {
  const { field, view, base, points, regions, lens, takes, stroke, playing, lit, panel } = props
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
  const margin = tile + 24
  const shown: { point: SkyPoint; x: number; y: number; look: StarLook }[] = []
  for (const point of points) {
    const spot = at(point)
    if (
      spot.x < -margin ||
      spot.y < -margin ||
      spot.x > width + margin ||
      spot.y > height + margin
    ) {
      continue
    }
    const look = starLook(point, view.scale)
    const reach = glowReach(point, look.r, view.scale, base)
    const alpha = starAlpha(point, lens)
    ctx.globalAlpha = alpha
    ctx.drawImage(glowOf(point.glow), spot.x - reach, spot.y - reach, reach * 2, reach * 2)
    if (look.star > 0.01) {
      ctx.globalAlpha = alpha * look.star
      if (point.flare) flare(ctx, spot, flareReach(point, look.r, view.scale, base), point.core)
      ctx.fillStyle = point.core
      ctx.beginPath()
      ctx.arc(spot.x, spot.y, look.r * CORE, 0, Math.PI * 2)
      ctx.fill()
    }
    if (look.cover > 0.01) shown.push({ point, x: spot.x, y: spot.y, look })
  }
  // The star under the pointer, named before it is pressed; else the one the
  // pointer is on in the tray's list.
  const under =
    (pointer ? songUnder(points, at, pointer, Math.max(14, tile / 2 + 4)) : null) ??
    (lit === null ? null : (byId.get(lit) ?? null))
  // Its cover open enough to wear its own name card (H2), rather than a ring.
  const underOpen = under !== null && starLook(under, view.scale).share > 0.5
  // The most played on top.
  shown.sort((a, b) => a.point.bright - b.point.bright)
  for (const { point, x, y, look } of shown) {
    const song = songs.get(point.id)
    const dim = lens !== null && !point.tagIds.includes(lens) ? 0.15 : 1
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
    // Close enough, each open cover wears its name: the one pointed at wears its card instead.
    if (song && look.share > 0.9 && tile >= NAMES_FROM && !(underOpen && point === under)) {
      ctx.globalAlpha = look.cover * dim * 0.92
      ctx.fillStyle = SKY_INK
      ctx.font = `600 10px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText(fitText(ctx, song.title, side + 16), x, y + half + 12)
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

  // The playing song: the one star wearing its cover.
  const now = playing === null ? undefined : byId.get(playing)
  const nowSong = now ? songs.get(now.id) : undefined
  if (now && nowSong) {
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

  // The song pointed at. Once its cover is open, the cover lifts into its own
  // name card (H2); while it is still a star, the star is ringed and named beside it.
  const song = under ? songs.get(under.id) : undefined
  if (under && song && underOpen) {
    const side = starLook(under, view.scale).side
    songCard(ctx, song, at(under), side, cover(song), under.glow, field.width - panel, field)
  } else if (under && song) {
    const spot = at(under)
    ctx.strokeStyle = SKY_INK
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(spot.x, spot.y, ringRadius(under, view.scale, 7), 0, Math.PI * 2)
    ctx.stroke()
    tooltip(ctx, song, spot, Math.max(14, starLook(under, view.scale).side / 2 + 8), field)
  }
}

/**
 * A cover pointed at, close in: lifted a little and set at the left end of a
 * dark card with its title and artist, one thing rather than a ring round the
 * cover and a label beside it. The cover stays on its star; the words go to
 * whichever side has the room, short of the tray's panel (`clear`).
 */
function songCard(
  ctx: CanvasRenderingContext2D,
  song: Song,
  spot: { x: number; y: number },
  side: number,
  image: HTMLImageElement | null,
  glow: string,
  clear: number,
  field: FieldSize,
): void {
  const big = Math.max(CARD_COVER.min, Math.min(CARD_COVER.max, side * 1.3))
  const pad = 4
  ctx.textAlign = 'left'
  ctx.font = `600 13px ${FONT}`
  const title = fitText(ctx, song.title, 220)
  const titleWidth = ctx.measureText(title).width
  ctx.font = `400 12px ${FONT}`
  const line = fitText(ctx, song.artist, 220)
  const words = Math.max(titleWidth, ctx.measureText(line).width)
  const width = pad + big + 12 + words + 16
  const height = big + pad * 2
  const right = spot.x - big / 2 - pad + width <= clear - 8
  const x = right ? spot.x - big / 2 - pad : spot.x + big / 2 + pad - width
  const y = Math.max(8, Math.min(field.height - height - 8, spot.y - height / 2))
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 8
  ctx.fillStyle = 'rgba(31,34,44,0.96)'
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, 14)
  ctx.fill()
  ctx.restore()
  const coverX = right ? x + pad : x + width - pad - big
  roundRect(ctx, coverX, y + pad, big, 10)
  if (image) {
    ctx.save()
    ctx.clip()
    ctx.drawImage(image, coverX, y + pad, big, big)
    ctx.restore()
  } else {
    ctx.fillStyle = glow
    ctx.fill()
  }
  const textX = right ? coverX + big + 12 : x + 16
  ctx.fillStyle = SKY_INK
  ctx.font = `600 13px ${FONT}`
  ctx.fillText(title, textX, y + height / 2 - 3)
  ctx.fillStyle = 'rgba(244,245,249,0.68)'
  ctx.font = `400 12px ${FONT}`
  ctx.fillText(line, textX, y + height / 2 + 14)
}

/** The cover in a song's card: a little larger than the tile, within reason. */
const CARD_COVER = { min: 52, max: 96 }

const FONT = '-apple-system, system-ui, "PingFang SC", "Hiragino Sans", sans-serif'
/** Covers this wide wear their titles underneath. */
const NAMES_FROM = 30

function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1)
  return `${cut}…`
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
