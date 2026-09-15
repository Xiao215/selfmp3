import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { FrequencyAnalyser, Rgb } from '@selfmp3/client'
import { hueFromString, type Song } from '@selfmp3/shared'
import { usePlayer } from '../../player/PlayerProvider'
import { canHearMusic } from '../../ports/liveAudio'
import { useReducedMotion } from './useReducedMotion'
import {
  beatKick,
  beatPhase,
  driftReach,
  driftSpeed,
  pulseRingAges,
  rgbCss,
  STILL_SECONDS,
  synthLevels,
  visualColors,
  visualFeel,
  type VisualColors,
  type VisualFeel,
  type VisualKind,
} from './visuals.model'

export interface SongVisualProps {
  song: Song
  kind: VisualKind
  /** Round the corners, for a visual in a box rather than one filling the screen. */
  rounded?: boolean
}

/**
 * A song's visual in a browser and the desktop app: a canvas, drawn once a
 * frame. The phone's is `SongVisual.tsx`.
 *
 * The loop reads the playhead straight from the engine each frame rather than
 * waiting for React, so a ring leaves on the beat and not up to a quarter of a
 * second after it; everything else the loop needs sits in one ref, so it
 * starts once per style. The browser pauses it with the tab. Spectrum listens
 * to the sound itself where that is safe (`ports/liveAudio`), and draws a
 * stand-in from the song's tempo and energy everywhere else. Reduce Motion
 * draws a single still frame, again only when the song, the style or the size
 * changes.
 */
export function SongVisual({ song, kind, rounded = false }: SongVisualProps): ReactNode {
  const player = usePlayer()
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const colors = useMemo(
    () =>
      visualColors(song.coverTone?.hue ?? hueFromString(song.album || song.title), song.features?.camelot),
    [song.coverTone?.hue, song.album, song.title, song.features?.camelot],
  )
  const feel = useMemo(() => visualFeel(song.features), [song.features])

  const live = useRef({ player, colors, feel, reduced, songId: song.id })
  useEffect(() => {
    live.current = { player, colors, feel, reduced, songId: song.id }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return undefined

    let analyser: FrequencyAnalyser | null = null
    let bins: Uint8Array | null = null
    const memory: Memory = { spin: 0, drift: 0, levels: [] }
    let last = performance.now()
    let stillKey = ''
    let frame = 0

    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { player: p, colors: c, feel: f, reduced: still, songId } = live.current

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (!width || !height) return
      const key = `${songId}:${width}x${height}:${c.inks[0].join()}`
      if (still && key === stillKey) return
      stillKey = still ? key : ''
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Asked for on the first Spectrum frame only: asking routes playback
      // through Web Audio for good.
      if (kind === 'spectrum' && !analyser && !still && canHearMusic()) {
        analyser = p.analyser()
        bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
      }
      let heard: number[] | null = null
      if (analyser && bins && p.isPlaying) {
        analyser.getByteFrequencyData(bins)
        // The top quarter of the bins is almost always empty in music; and a
        // steep curve, since a modern master sits near the top of the byte
        // range and a gentle one draws every bar at full length.
        const usable = Math.floor(bins.length * 0.75)
        heard = []
        for (let i = 0; i < usable; i++) heard.push(Math.min(1, Math.pow((bins[i] ?? 0) / 255, 2.6) * 1.25))
      }

      draw(kind, ctx, width, height, {
        time: still ? STILL_SECONDS : p.getPlayhead(),
        dt: still ? 0 : dt,
        playing: still || p.isPlaying,
        feel: f,
        colors: c,
        heard,
      }, memory)
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

interface Frame {
  /** Song position in seconds; the beat is worked out from it. */
  readonly time: number
  /** Seconds since the last frame, for what drifts. */
  readonly dt: number
  readonly playing: boolean
  readonly feel: VisualFeel
  readonly colors: VisualColors
  /** Live levels 0–1, low to high, when the music can be heard. */
  readonly heard: readonly number[] | null
}

interface Memory {
  spin: number
  drift: number
  levels: number[]
}

type Ctx = CanvasRenderingContext2D

function draw(kind: VisualKind, ctx: Ctx, w: number, h: number, f: Frame, m: Memory): void {
  const phase = beatPhase(f.time, f.feel.bpm)
  const kick = f.playing ? beatKick(phase) : 0
  ground(ctx, w, h, f.colors, kick * 0.04 * f.feel.energy)
  DRAWINGS[kind](ctx, w, h, f, m, phase, kick)
}

function ground(ctx: Ctx, w: number, h: number, colors: VisualColors, lift: number): void {
  const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75)
  const [middle, edge] = colors.ground
  glow.addColorStop(0, rgbCss(lighten(middle, lift)))
  glow.addColorStop(1, rgbCss(edge))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)
}

const DRAWINGS: Record<
  VisualKind,
  (ctx: Ctx, w: number, h: number, f: Frame, m: Memory, phase: number, kick: number) => void
> = {
  /* Slow bands in the cover's colours; brightness breathes with loudness. */
  aurora(ctx, w, h, f, m) {
    const speed = f.playing ? 0.18 + 0.5 * f.feel.energy : 0
    m.drift += speed * f.dt
    const t = m.drift
    ctx.globalCompositeOperation = 'lighter'
    for (let band = 0; band < 4; band++) {
      const y0 = h * (0.3 + band * 0.13)
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let x = 0; x <= w; x += 8) {
        const y =
          y0 +
          Math.sin((x / w) * 3 + t * 0.9 + band) * h * 0.09 +
          Math.sin((x / w) * 7 - t * 1.4 + band * 2) * h * 0.03 * (0.5 + f.feel.danceability)
        ctx.lineTo(x, y)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      const breath = 0.16 + 0.12 * f.feel.loudness + 0.05 * Math.sin(t * 2.2 + band)
      const fill = ctx.createLinearGradient(0, y0 - h * 0.2, 0, h)
      const ink = f.colors.inks[band % 3]!
      fill.addColorStop(0, rgbCss(ink, breath))
      fill.addColorStop(1, rgbCss(ink, 0))
      ctx.fillStyle = fill
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  },

  /* Rings leave the centre on every beat; the centre dot kicks. */
  pulse(ctx, w, h, f, _m, phase, kick) {
    const reach = Math.min(w, h) * 0.48
    const cx = w / 2
    const cy = h / 2
    if (f.playing) {
      pulseRingAges(phase).forEach((age, ring) => {
        ctx.beginPath()
        ctx.arc(cx, cy, age * reach, 0, Math.PI * 2)
        ctx.strokeStyle = rgbCss(f.colors.inks[ring % 2]!, Math.pow(1 - age, 1.5) * 0.85)
        ctx.lineWidth = 1.5 + f.feel.energy * 4 * (1 - age)
        ctx.stroke()
      })
    }
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach * 0.5)
    halo.addColorStop(0, rgbCss(f.colors.inks[0], 0.18 + 0.2 * kick))
    halo.addColorStop(1, rgbCss(f.colors.inks[0], 0))
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, w, h)
    ctx.beginPath()
    ctx.arc(cx, cy, Math.min(w, h) * (0.045 + 0.035 * kick), 0, Math.PI * 2)
    ctx.fillStyle = rgbCss(f.colors.inks[2], 0.95)
    ctx.fill()
  },

  /* Bars for the sound: heard where it can be, drawn from the beat elsewhere. */
  spectrum(ctx, w, h, f, m) {
    const count = Math.max(16, Math.min(48, Math.floor(w / 18)))
    const target = f.heard
      ? resample(f.heard, count)
      : synthLevels(count, f.time, f.feel.bpm, f.feel.energy)
    if (m.levels.length !== count) m.levels = new Array<number>(count).fill(0)
    for (let i = 0; i < count; i++) {
      const goal = f.playing ? (target[i] ?? 0) : 0.02
      const now = m.levels[i] ?? 0
      m.levels[i] = now + (goal - now) * (goal > now ? 0.55 : 0.12)
    }
    const gap = Math.max(2, w / count / 5)
    const barWidth = (w - gap * (count + 1)) / count
    const floor = h * 0.86
    for (let i = 0; i < count; i++) {
      const level = m.levels[i] ?? 0
      const barHeight = Math.max(3, level * h * 0.7)
      const x = gap + i * (barWidth + gap)
      const along = i / count
      const ink = along < 0.5 ? f.colors.inks[0] : f.colors.inks[1]
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

  /* Specks orbiting the centre: faster with tempo, closer with energy. */
  drift(ctx, w, h, f, m, _phase, kick) {
    m.spin += f.playing ? driftSpeed(f.feel.bpm) * f.dt : 0
    const cx = w / 2
    const cy = h / 2
    const base = Math.min(w, h)
    const reach = driftReach(f.feel.energy)
    const specks = 70
    for (let i = 0; i < specks; i++) {
      const angle = i * 2.39996 + m.spin * (1 + (i % 3) * 0.25)
      const radius = base * (0.06 + (i / specks) * reach) * (1 + 0.06 * kick)
      ctx.beginPath()
      ctx.arc(
        cx + Math.cos(angle) * radius * 1.25,
        cy + Math.sin(angle) * radius * 0.85,
        1.2 + (i % 4) * 0.7,
        0,
        Math.PI * 2,
      )
      ctx.fillStyle = rgbCss(f.colors.inks[i % 3]!, 0.7)
      ctx.fill()
    }
  },
}

function resample(source: readonly number[], count: number): number[] {
  return Array.from(
    { length: count },
    (_, i) => source[Math.min(source.length - 1, Math.floor((i / count) * source.length))] ?? 0,
  )
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
