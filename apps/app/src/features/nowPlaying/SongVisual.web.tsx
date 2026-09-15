import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Rgb } from '@selfmp3/client'
import { hueFromString, type Song } from '@selfmp3/shared'
import { usePlayer } from '../../player/PlayerProvider'
import type { MotionSampler } from './motionSource'
import { useReducedMotion } from './useReducedMotion'
import { recordVisualFrame } from './visualDebug'
import {
  AURORA_INKS,
  auroraBrightness,
  createMotionState,
  motionTuning,
  resizeBands,
  ringFade,
  ringReach,
  stepMotion,
  stillMotion,
  type MotionState,
  type MotionTuning,
} from './visualMotion.model'
import {
  driftReach,
  rgbCss,
  visualColors,
  visualFeel,
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
export function SongVisual({ song, kind, sampler, rounded = false }: SongVisualProps): ReactNode {
  const player = usePlayer()
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const colors = useMemo(
    () =>
      visualColors(
        song.coverTone?.hue ?? hueFromString(song.album || song.title),
        song.audioFeatures?.camelot,
        song.coverTone?.palette,
      ),
    [
      song.coverTone?.hue,
      song.coverTone?.palette,
      song.album,
      song.title,
      song.audioFeatures?.camelot,
    ],
  )
  const bpmKnown = song.audioFeatures?.bpm != null
  const tuning = useMemo(
    () => motionTuning(visualFeel(song.audioFeatures), bpmKnown),
    [song.audioFeatures, bpmKnown],
  )

  const live = useRef({ player, colors, tuning, reduced, sampler, songId: song.id })
  useEffect(() => {
    live.current = { player, colors, tuning, reduced, sampler, songId: song.id }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return undefined

    const motion = createMotionState(16)
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

      resizeBands(motion, kind === 'spectrum' ? spectrumBars(width) : 16)
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
      draw(kind, ctx, width, height, c, tu, motion)
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
        borderRadius: rounded ? 14 : 0,
      }}
    />
  )
}

/** Spectrum's bar count for a width: about one bar every 18 points, 16 to 48 of them. */
function spectrumBars(width: number): number {
  return Math.max(16, Math.min(48, Math.floor(width / 18)))
}

type Ctx = CanvasRenderingContext2D

type Drawing = (ctx: Ctx, w: number, h: number, c: VisualColors, tu: MotionTuning, m: MotionState) => void

function draw(
  kind: VisualKind,
  ctx: Ctx,
  w: number,
  h: number,
  c: VisualColors,
  tu: MotionTuning,
  m: MotionState,
): void {
  ground(ctx, w, h, c, m.kick * 0.05 * m.glow + m.flash * 0.05)
  DRAWINGS[kind](ctx, w, h, c, tu, m)
}

function ground(ctx: Ctx, w: number, h: number, colors: VisualColors, lift: number): void {
  const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75)
  const [middle, edge] = colors.ground
  glow.addColorStop(0, rgbCss(lighten(middle, lift)))
  glow.addColorStop(1, rgbCss(edge))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)
}

const DRAWINGS: Record<VisualKind, Drawing> = {
  /* Bands in the cover's colours: taller, brighter and quicker the louder it is; a flash on a big hit. */
  aurora(ctx, w, h, c, tu, m) {
    const g = m.glow
    const t = m.sway
    ctx.globalCompositeOperation = 'lighter'
    for (let band = 0; band < 4; band++) {
      const y0 = h * (0.34 + band * 0.12 + (1 - g) * 0.16)
      const swell = h * (0.025 + 0.085 * g)
      const ripple = h * (0.01 + 0.03 * g) * (0.5 + tu.feel.danceability)
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let x = 0; x <= w; x += 8) {
        const y =
          y0 +
          Math.sin((x / w) * 3 + t * 0.9 + band) * swell +
          Math.sin((x / w) * 7 - t * 1.4 + band * 2) * ripple
        ctx.lineTo(x, y)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      const breath = 0.45 * auroraBrightness(g, m.flash) + 0.03 * Math.sin(t * 2.2 + band)
      const fill = ctx.createLinearGradient(0, y0 - h * 0.2, 0, h)
      const ink = c.inks[AURORA_INKS[band]!]
      fill.addColorStop(0, rgbCss(ink, breath))
      fill.addColorStop(1, rgbCss(ink, 0))
      ctx.fillStyle = fill
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  },

  /* A ring leaves the centre on each hit, as strong as the hit; the dot follows the level and kicks. */
  pulse(ctx, w, h, c, tu, m) {
    const reach = Math.min(w, h) * 0.48
    const cx = w / 2
    const cy = h / 2
    for (const ring of m.rings) {
      const travelled = ringReach(ring, tu)
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(1, travelled * reach), 0, Math.PI * 2)
      ctx.strokeStyle = rgbCss(c.inks[ring.id % 2]!, ringFade(ring, tu) * 0.9)
      ctx.lineWidth = 1 + 7 * ring.strength * (1 - travelled)
      ctx.stroke()
    }
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach * (0.35 + 0.25 * m.glow))
    halo.addColorStop(0, rgbCss(c.inks[0], 0.05 + 0.22 * m.glow + 0.25 * m.kick))
    halo.addColorStop(1, rgbCss(c.inks[0], 0))
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, w, h)
    ctx.beginPath()
    ctx.arc(cx, cy, Math.min(w, h) * (0.02 + 0.035 * m.glow + 0.03 * m.kick), 0, Math.PI * 2)
    ctx.fillStyle = rgbCss(c.inks[2], 0.95)
    ctx.fill()
  },

  /* Bars for the sound: heard where it can be, from the song's curve or tempo elsewhere. */
  spectrum(ctx, w, h, c, _tu, m) {
    const count = m.bands.length
    const gap = Math.max(2, w / count / 5)
    const barWidth = (w - gap * (count + 1)) / count
    const floor = h * 0.86
    for (let i = 0; i < count; i++) {
      const level = m.bands[i] ?? 0
      const barHeight = Math.max(3, level * h * 0.7)
      const x = gap + i * (barWidth + gap)
      const ink = i / count < 0.5 ? c.inks[0] : c.inks[1]
      const fill = ctx.createLinearGradient(0, floor - barHeight, 0, floor)
      fill.addColorStop(0, rgbCss(ink, 0.95))
      fill.addColorStop(1, rgbCss(ink, 0.35))
      ctx.fillStyle = fill
      roundedBar(ctx, x, floor - barHeight, barWidth, barHeight, Math.min(3, barWidth / 2))
      // The reflection, faint, so the bars stand on something.
      ctx.fillStyle = rgbCss(ink, 0.08)
      ctx.fillRect(x, floor + 2, barWidth, barHeight * 0.18)
    }
  },

  /* Specks orbiting the centre: faster the louder it is, thrown outward on a hit. */
  drift(ctx, w, h, c, tu, m) {
    const cx = w / 2
    const cy = h / 2
    const base = Math.min(w, h)
    const reach = driftReach(tu.feel.energy)
    const specks = 70
    for (let i = 0; i < specks; i++) {
      const along = i / specks
      const angle = i * 2.39996 + m.spin * (1 + (i % 3) * 0.25)
      const radius = base * (0.06 + along * reach) * (1 + 0.3 * m.burst * (0.4 + 0.6 * along))
      ctx.beginPath()
      ctx.arc(
        cx + Math.cos(angle) * radius * 1.25,
        cy + Math.sin(angle) * radius * 0.85,
        (1.2 + (i % 4) * 0.7) * (0.8 + 0.4 * m.glow),
        0,
        Math.PI * 2,
      )
      ctx.fillStyle = rgbCss(c.inks[i % 3]!, 0.3 + 0.55 * m.glow)
      ctx.fill()
    }
  },
}

function lighten([r, g, b]: Rgb, amount: number): Rgb {
  return [r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]
}

function roundedBar(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x, y + h)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fill()
}
