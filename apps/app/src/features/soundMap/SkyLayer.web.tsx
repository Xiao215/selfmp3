import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { View } from 'react-native'
import { useUnistyles } from 'react-native-unistyles'
import type { MapPlace, Song } from '@selfmp3/shared'
import { tagColors } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { useFieldPointer } from './fieldInput'
import {
  CORE,
  dustSpecks,
  glowReach,
  GLOW_STOPS,
  SKY_EDGE,
  SKY_INK,
  SKY_TOP,
  songUnder,
  starAlpha,
  starRadius,
  type SkyLayerProps,
  type SkyPoint,
} from './sky.model'
import { COVER_FROM, tileSide, toScreen, type FieldSize } from './soundMapView.model'

/**
 * The sound map's sky in a browser and the desktop app: one canvas, drawn
 * again at most once a frame while the map moves, and not at all while it
 * holds still.
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
  const ground = useGround(field)
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
      draw(ctx, canvas, now, placed, ink, pointer, ground, song =>
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
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  )
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
  ground: HTMLCanvasElement | null,
  cover: (song: Song) => HTMLImageElement | null,
): void {
  const { field, view, base, points, regions, lens, takes, stroke, playing, pulse, songs } = props
  const { width, height } = field
  const dpr = dprOf()
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (ground) ctx.drawImage(ground, 0, 0)
  else ctx.clearRect(0, 0, canvas.width, canvas.height)
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
  // a place of a few hundred songs summed to one white blur. Close in, the
  // covers on screen in place of theirs.
  const side = tileSide(view.scale)
  const covers = side >= COVER_FROM
  const margin = covers ? side : 24
  const shown: { point: SkyPoint; x: number; y: number }[] = []
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
    const r = starRadius(view.scale, point.bright) * (covers ? 1.8 : 1)
    const reach = glowReach(point, r, view.scale, base)
    const alpha = starAlpha(point, lens)
    ctx.globalAlpha = alpha
    ctx.drawImage(glowOf(point.glow), spot.x - reach, spot.y - reach, reach * 2, reach * 2)
    if (covers) shown.push({ point, x: spot.x, y: spot.y })
    else {
      ctx.fillStyle = point.core
      ctx.beginPath()
      ctx.arc(spot.x, spot.y, r * CORE, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  for (const { point, x, y } of shown) {
    const song = songs.get(point.id)
    ctx.globalAlpha = lens !== null && !point.tagIds.includes(lens) ? 0.15 : 1
    roundRect(ctx, x - side / 2, y - side / 2, side, side * 0.16)
    const image = song ? cover(song) : null
    if (image) {
      ctx.save()
      ctx.clip()
      ctx.drawImage(image, x - side / 2, y - side / 2, side, side)
      ctx.restore()
    } else {
      ctx.fillStyle = point.glow
      ctx.fill()
    }
    // Close enough, each cover wears its name.
    if (song && side >= NAMES_FROM) {
      ctx.globalAlpha *= 0.92
      ctx.fillStyle = SKY_INK
      ctx.font = `600 10px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText(fitText(ctx, song.title, side + 16), x, y + side / 2 + 12)
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
      ctx.fillStyle = withAlpha(accent, 0.08)
      ctx.fill()
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = 'rgba(244,245,249,0.7)'
      ctx.lineWidth = 1.4
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
      ctx.strokeStyle = 'rgba(244,245,249,0.72)'
      ctx.lineWidth = 1.1
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
      ctx.strokeStyle = 'rgba(244,245,249,0.5)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(spot.x, spot.y, covers ? side * 0.7 : 5.5, 0, Math.PI * 2)
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
    const big = Math.max(22, covers ? side * 1.15 : 22)
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

  // The star under the pointer, named before it is pressed.
  const under = pointer ? songUnder(points, at, pointer, covers ? side / 2 + 4 : 14) : null
  const song = under ? songs.get(under.id) : undefined
  if (under && song) {
    const spot = at(under)
    ctx.strokeStyle = SKY_INK
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(spot.x, spot.y, covers ? side * 0.72 : 7, 0, Math.PI * 2)
    ctx.stroke()
    tooltip(ctx, song, spot, covers ? side / 2 + 8 : 14, field)
  }
}

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
