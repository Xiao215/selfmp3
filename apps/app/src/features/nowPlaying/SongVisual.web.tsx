import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { radius, rgba, type Rgb } from '@selfmp3/client'
import type { Song } from '@selfmp3/shared'
import { usePlayer } from '../../player/PlayerProvider'
import type { MotionSampler } from './motionSource.model'
import { useMotionReduced } from '../../ui/motion'
import { useVisualLook } from './useVisualLook'
import { recordVisualFrame } from './visualDebug'
import {
  createMotionState,
  HILL_LAYERS,
  hillShare,
  hillShift,
  hillX,
  ringFade,
  ringReach,
  stepMotion,
  stillMotion,
  type MotionState,
  type MotionTuning,
} from './visualMotion.model'
import {
  horizonColors,
  RING_FROM,
  RING_TO,
  rippleDisc,
  sunPlace,
  type VisualColors,
  type VisualKind,
} from './visuals.model'

export interface SongVisualProps {
  song: Song
  kind: VisualKind
  /** What the visual follows: the sound, the song's curve, or its tempo (`useMotionSampler`). */
  sampler: MotionSampler
  /** Round the corners, for a visual in a box rather than one filling the screen. */
  rounded?: boolean
  /** The song's cover: Ripples' disc is the cover itself (docs/ui-mock `P24`). */
  cover?: string | null
}

/**
 * A song's visual in a browser and the desktop app: a canvas, drawn once a
 * frame. The phone's is `SongVisual.tsx`.
 *
 * Each frame reads the playhead straight from the engine, asks the sampler
 * what the music is doing there, steps the motion (`visualMotion.model.ts`)
 * and draws it — so a ring leaves on the hit and not a quarter of a second
 * after it. Everything else the loop needs sits in one ref, so it starts once
 * per style; the browser pauses it with the tab. Reduce Motion draws a single
 * still frame, again only when the song, the style or the size changes.
 */
export function SongVisual({
  song,
  kind,
  sampler,
  rounded = false,
  cover: coverUri = null,
}: SongVisualProps): ReactNode {
  const player = usePlayer()
  const reduced = useMotionReduced()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { colors, tuning } = useVisualLook(song)
  const cover = useCoverImage(coverUri)

  const live = useRef({ player, colors, tuning, reduced, sampler, songId: song.id, cover })
  useEffect(() => {
    live.current = { player, colors, tuning, reduced, sampler, songId: song.id, cover }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return undefined

    const motion = createMotionState(live.current.tuning.feel.loudness)
    let last = performance.now()
    let stillKey = ''
    let frame = 0

    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { player: p, colors: c, tuning: tu, reduced: still, sampler: s, songId } = live.current

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (!width || !height) return
      const key = `${songId}:${width}x${height}:${c.inks[0].join()}:${s.source}`
      if (still && key === stillKey) return
      stillKey = still ? key : ''
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (still) {
        stillMotion(motion, tu, s.source)
      } else {
        const seconds = p.getPlayhead()
        stepMotion(motion, s, seconds, dt, p.isPlaying, tu)
        recordVisualFrame({
          t: seconds,
          source: s.source,
          kind,
          level: motion.level,
          onset: motion.onset,
          glow: motion.glow,
          fired: motion.fired,
          rings: motion.rings.length,
          ...(s as { trace?: object }).trace,
        })
      }
      draw(kind, ctx, width, height, c, tu, motion, live.current.cover.current)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [kind])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        borderRadius: rounded ? radius.card : 0,
      }}
    />
  )
}

/**
 * The song's cover as an image a canvas can draw, or null until it is there.
 * Asked for with CORS, because a canvas that has drawn an image from another
 * address without it cannot be read back (saving the month as an image).
 */
function useCoverImage(uri: string | null): { current: HTMLImageElement | null } {
  const held = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    held.current = null
    if (!uri) return undefined
    const image = new window.Image()
    image.crossOrigin = 'anonymous'
    image.src = uri
    const ready = (): void => {
      held.current = image
    }
    image.addEventListener('load', ready)
    return () => {
      image.removeEventListener('load', ready)
      held.current = null
    }
  }, [uri])
  return held
}

type Ctx = CanvasRenderingContext2D

type Drawing = (
  ctx: Ctx,
  w: number,
  h: number,
  c: VisualColors,
  tu: MotionTuning,
  m: MotionState,
  /** The song's cover, once it has loaded: Ripples' disc is the cover itself. */
  cover: HTMLImageElement | null,
) => void

function draw(
  kind: VisualKind,
  ctx: Ctx,
  w: number,
  h: number,
  c: VisualColors,
  tu: MotionTuning,
  m: MotionState,
  cover: HTMLImageElement | null,
): void {
  DRAWINGS[kind](ctx, w, h, c, tu, m, cover)
}

const DRAWINGS: Record<VisualKind, Drawing> = {
  /* A dusk sky in the song's colours, a sun that swells on each hit, and three hill lines drawn from the loudness heard, rolling left. */
  horizon(ctx, w, h, c, _tu, m) {
    const look = horizonColors(c)
    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, rgba(look.sky[0]))
    sky.addColorStop(0.42, rgba(look.sky[1]))
    sky.addColorStop(0.74, rgba(look.sky[2]))
    sky.addColorStop(1, rgba(look.sky[3]))
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)

    const sun = sunPlace(w, h)
    const r = (sun.d / 2) * (0.94 + 0.08 * m.glow + 0.14 * m.swell)
    const glow = ctx.createRadialGradient(sun.x, sun.y, r * 0.6, sun.x, sun.y, sun.d * 1.3)
    const shine = Math.min(1, 0.35 + 0.4 * m.glow + 0.25 * m.flash)
    glow.addColorStop(0, rgba(look.sun, 0.45 * shine))
    glow.addColorStop(1, rgba(look.sun, 0))
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
    ctx.beginPath()
    ctx.arc(sun.x, sun.y, r, 0, Math.PI * 2)
    ctx.fillStyle = rgba(look.sun)
    ctx.fill()

    HILL_LAYERS.forEach((layer, index) => {
      const trail = m.hills[index]!
      const shift = hillShift(trail)
      const foot = h * layer.base
      const rise = h * layer.rise
      const at = (i: number): [number, number] => [
        hillX(i, shift, w, layer.gaps),
        foot - rise * hillShare(trail.levels[i] ?? 0),
      ]
      // A smooth line through the points: each one a control point, the curve
      // passing through the midpoints between them.
      ctx.beginPath()
      const [x0, y0] = at(0)
      ctx.moveTo(x0, h)
      ctx.lineTo(x0, y0)
      for (let i = 1; i < trail.levels.length; i++) {
        const [px, py] = at(i - 1)
        const [x, y] = at(i)
        ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2)
      }
      const [xn, yn] = at(trail.levels.length - 1)
      ctx.lineTo(xn, yn)
      ctx.lineTo(xn, h)
      ctx.closePath()
      ctx.fillStyle = rgba(look.hills[index]!)
      ctx.fill()
    })

    const fade = ctx.createLinearGradient(0, h * 0.6, 0, h * 0.86)
    fade.addColorStop(0, rgba(look.foot, 0))
    fade.addColorStop(1, rgba(look.foot))
    ctx.fillStyle = fade
    ctx.fillRect(0, h * 0.6, w, h * 0.4)
  },

  /* The cover as a disc that kicks on each hit and sends a ring out from behind it, as strong as the hit. */
  ripples(ctx, w, h, c, tu, m, cover) {
    const [middle, edge] = c.ground
    const ground = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75)
    ground.addColorStop(0, rgba(lighten(middle, m.flash * 0.05)))
    ground.addColorStop(1, rgba(edge))
    ctx.fillStyle = ground
    ctx.fillRect(0, 0, w, h)
    wash(ctx, w * 0.2, h * 0.18, Math.max(w, h) * 0.6, c.inks[0], 0.2)
    wash(ctx, w * 0.82, h * 0.84, Math.max(w, h) * 0.6, c.inks[1], 0.16)

    const cx = w / 2
    const cy = h / 2
    const disc = rippleDisc(w, h)
    const halo = Math.min(1, 0.15 + 0.45 * m.glow + 0.3 * m.kick)
    wash(ctx, cx, cy, disc * 0.95, c.inks[0], 0.5 * halo, 0.4)

    for (const ring of m.rings) {
      const scale = RING_FROM + (RING_TO - RING_FROM) * ringReach(ring, tu)
      ctx.beginPath()
      ctx.arc(cx, cy, (disc / 2) * scale, 0, Math.PI * 2)
      ctx.strokeStyle = rgba(
        c.inks[RING_INKS[ring.id % RING_INKS.length]!],
        ringFade(ring, tu) * 0.85,
      )
      ctx.lineWidth = (1.5 + 1.5 * ring.strength) * scale
      ctx.stroke()
    }

    const r = (disc / 2) * (1 + 0.06 * m.kick)
    const fill = ctx.createRadialGradient(
      cx - r * 0.16,
      cy - r * 0.24,
      0,
      cx - r * 0.16,
      cy - r * 0.24,
      r * 1.4,
    )
    fill.addColorStop(0, rgba(c.inks[2]))
    fill.addColorStop(0.7, rgba(c.inks[0]))
    fill.addColorStop(1, rgba(c.inks[1]))
    ctx.save()
    // P24's disc sits above the page on a deep, soft shadow.
    ctx.shadowColor = rgba(edge, 0.6)
    ctx.shadowBlur = 50
    ctx.shadowOffsetY = 20
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.restore()

    // The cover itself inside that circle (`P24`); the colours above stand in
    // until it has loaded, and for a song that has no cover.
    if (cover?.complete && cover.naturalWidth > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()
      const side = Math.min(cover.naturalWidth, cover.naturalHeight)
      ctx.drawImage(
        cover,
        (cover.naturalWidth - side) / 2,
        (cover.naturalHeight - side) / 2,
        side,
        side,
        cx - r,
        cy - r,
        r * 2,
        r * 2,
      )
      ctx.restore()
    }
  },
}

/** Which ink each ring draws in, in turn: the lead, then the other two, as P24's rings take turns. */
const RING_INKS = [2, 0, 1] as const

/** A soft round glow of one ink, `alpha` at its middle (and out to `solid` of its radius), none at its edge. */
function wash(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  ink: Rgb,
  alpha: number,
  solid = 0,
): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius)
  glow.addColorStop(solid, rgba(ink, alpha))
  glow.addColorStop(1, rgba(ink, 0))
  ctx.fillStyle = glow
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
}

function lighten([r, g, b]: Rgb, amount: number): Rgb {
  return [r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]
}
