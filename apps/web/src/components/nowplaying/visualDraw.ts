import { rgba, type Rgb, type VisualKind } from '../../lib/visuals.js'

/**
 * The four drawings, as plain canvas functions.
 *
 * Each gets the song's facts and the moment it is drawing, and keeps what it
 * needs between frames in `memory`. Nothing here knows about React or the
 * player, so a drawing can be looked at in isolation.
 */

export interface Frame {
  /** Song position in seconds; the beat is worked out from it. */
  readonly time: number
  /** Seconds since the last frame, for things that drift. */
  readonly dt: number
  readonly playing: boolean
  /** Reduce Motion: draw the scene, but hold it still. */
  readonly still: boolean
  readonly bpm: number
  readonly energy: number
  readonly danceability: number
  readonly palette: readonly [Rgb, Rgb, Rgb]
  readonly cover: CanvasImageSource | null
  /** Live levels 0–1, low to high, when the music can be heard; else null. */
  readonly spectrum: Float32Array | null
}

export interface Memory {
  drift?: number
  spin?: number
  levels?: Float32Array
  history?: Float32Array[]
  sinceRow?: number
}

const GROUND = '#0c0b13'

export function draw(
  kind: VisualKind,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: Frame,
  memory: Memory,
): void {
  DRAWINGS[kind](ctx, width, height, frame, memory)
}

const DRAWINGS: Record<
  VisualKind,
  (ctx: CanvasRenderingContext2D, w: number, h: number, f: Frame, m: Memory) => void
> = {
  /* The cover breathes on each beat and sends out a ring. */
  pulse(ctx, w, h, f) {
    ctx.fillStyle = GROUND
    ctx.fillRect(0, 0, w, h)
    const m = Math.min(w, h)
    const cx = w / 2
    const cy = h / 2
    const phase = ((f.time * f.bpm) / 60) % 1
    const moving = f.playing && !f.still
    const beat = moving ? Math.exp(-phase * 5) : 0

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.75)
    glow.addColorStop(0, rgba(f.palette[0], 0.2 + 0.18 * f.energy * (0.6 + 0.4 * beat)))
    glow.addColorStop(0.5, rgba(f.palette[1], 0.08))
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)

    const r = m * 0.22
    const reach = m * (0.1 + 0.28 * f.energy)
    if (moving) {
      for (let j = 0; j < 4; j++) {
        const age = (phase + j) / 4
        const size = r * 1.15 + age * reach * 2.2
        ctx.strokeStyle = rgba(f.palette[j % 2 === 0 ? 0 : 1], Math.pow(1 - age, 2) * 0.7)
        ctx.lineWidth = 2.2 * (1 - age) + 0.6
        roundRect(ctx, cx - size, cy - size, size * 2, size * 2, size * 0.18 + age * size * 0.8)
        ctx.stroke()
      }
    }

    const k = r * (1 + 0.035 * (0.4 + f.energy) * beat)
    drawCover(ctx, f, cx - k, cy - k, k * 2, k * 0.08)
  },

  /* Slow ribbons in the cover's colours: energy sets the drift, danceability the ripple. */
  aurora(ctx, w, h, f, mem) {
    const ground = ctx.createLinearGradient(0, 0, 0, h)
    ground.addColorStop(0, '#07060d')
    ground.addColorStop(1, rgba(f.palette[2], 0.95))
    ctx.fillStyle = ground
    ctx.fillRect(0, 0, w, h)

    const speed = f.playing && !f.still ? 0.12 + 0.8 * f.energy : 0
    mem.drift = (mem.drift ?? 0) + speed * f.dt
    const t = mem.drift
    const beat = f.playing && !f.still ? Math.exp(-(((f.time * f.bpm) / 60) % 1) * 4) : 0
    const colours = [f.palette[0], f.palette[1], f.palette[0]] as const

    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = 2
    for (let ribbon = 0; ribbon < 3; ribbon++) {
      for (let strand = 0; strand < 16; strand++) {
        ctx.beginPath()
        for (let i = 0; i <= 64; i++) {
          const x = (i / 64) * w
          const y =
            h * (0.34 + 0.16 * ribbon) +
            Math.sin(
              x * 0.0045 * (1 + f.danceability) +
                t * (0.7 + ribbon * 0.25) +
                ribbon * 2.1 +
                strand * 0.045,
            ) *
              h *
              0.13 +
            Math.sin(x * 0.012 - t * 0.9 + ribbon * 1.3) * h * 0.05 * (0.4 + f.danceability) +
            strand * h * 0.006
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = rgba(colours[ribbon]!, (0.05 + 0.02 * beat) * (1 - strand / 20))
        ctx.stroke()
      }
    }
    ctx.globalCompositeOperation = 'source-over'
  },

  /* Frequency bars around a slowly turning cover. */
  ring(ctx, w, h, f, mem) {
    ctx.fillStyle = GROUND
    ctx.fillRect(0, 0, w, h)
    const levels = levelsFor(f, mem, 56)
    const m = Math.min(w, h)
    const cx = w / 2
    const cy = h / 2
    const r = m * 0.2
    const n = levels.length

    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(2, m * 0.009)
    for (let i = 0; i < n * 2; i++) {
      // Mirrored, so the bass meets itself at the top and the ring is symmetrical.
      const v = levels[i < n ? i : n * 2 - 1 - i] ?? 0
      const angle = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2
      const length = 4 + v * m * 0.2
      ctx.strokeStyle = rgba(f.palette[i % 2 === 0 ? 0 : 1], 0.55 + 0.45 * Math.min(1, v))
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(angle) * (r + 8), cy + Math.sin(angle) * (r + 8))
      ctx.lineTo(cx + Math.cos(angle) * (r + 8 + length), cy + Math.sin(angle) * (r + 8 + length))
      ctx.stroke()
    }

    mem.spin = (mem.spin ?? 0) + (f.playing && !f.still ? f.dt * 0.25 : 0)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.translate(cx, cy)
    ctx.rotate(mem.spin)
    if (f.cover) ctx.drawImage(f.cover, -r, -r, r * 2, r * 2)
    else {
      ctx.fillStyle = rgba(f.palette[1], 1)
      ctx.fillRect(-r, -r, r * 2, r * 2)
    }
    ctx.restore()
    ctx.fillStyle = GROUND
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.09, 0, Math.PI * 2)
    ctx.fill()
  },

  /* A short history of the spectrum stacked into ridges, newest at the bottom. */
  ridges(ctx, w, h, f, mem) {
    ctx.fillStyle = GROUND
    ctx.fillRect(0, 0, w, h)
    const levels = levelsFor(f, mem, 64)
    const rows = 30
    mem.history ??= []
    mem.sinceRow = (mem.sinceRow ?? 0) + f.dt
    if (mem.history.length === 0 || (mem.sinceRow > 0.09 && f.playing && !f.still)) {
      mem.sinceRow = 0
      mem.history.push(Float32Array.from(levels))
      if (mem.history.length > rows) mem.history.shift()
    }

    const top = h * 0.2
    const bottom = h * 0.86
    const gap = (bottom - top) / rows
    const left = w * 0.22
    const right = w * 0.78
    const n = levels.length
    const count = mem.history.length

    mem.history.forEach((row, index) => {
      const y0 = top + (rows - count + index) * gap
      ctx.beginPath()
      ctx.moveTo(left, y0)
      for (let i = 0; i < n; i++) {
        const x01 = i / (n - 1)
        // Bass in the middle, treble at the edges, under a bell so the ends lie flat.
        const bin = Math.min(n - 1, Math.floor(Math.abs(x01 - 0.5) * 2 * (n - 1)))
        const bell = Math.exp(-Math.pow((x01 - 0.5) / 0.2, 2))
        ctx.lineTo(left + x01 * (right - left), y0 - (row[bin] ?? 0) * h * 0.2 * bell - bell * 2)
      }
      ctx.lineTo(right, y0)
      ctx.lineTo(right, y0 + gap * 2)
      ctx.lineTo(left, y0 + gap * 2)
      ctx.closePath()
      ctx.fillStyle = GROUND
      ctx.fill()
      const newest = index === count - 1
      ctx.strokeStyle = newest
        ? rgba(f.palette[0], 1)
        : `rgba(236, 232, 255, ${0.18 + 0.6 * (index / count)})`
      ctx.lineWidth = newest ? 1.8 : 1.1
      ctx.stroke()
    })
  },
}

/**
 * Levels for the spectrum drawings: the live sound when there is one, and a
 * stand-in built from the song's tempo and energy when there is not — a
 * choice made on the Mac can still be looked at somewhere else.
 */
function levelsFor(f: Frame, mem: Memory, count: number): Float32Array {
  if (!mem.levels || mem.levels.length !== count) mem.levels = new Float32Array(count)
  const out = mem.levels
  const beats = (f.time * f.bpm) / 60
  const kick = Math.exp(-(beats % 1) * 7)
  const hat = Math.exp(-((beats * 2) % 1) * 12)

  for (let i = 0; i < count; i++) {
    let target: number
    if (f.spectrum) {
      // Resampled from the analyser's bins; they are already smoothed there.
      const source = f.spectrum
      target = source[Math.min(source.length - 1, Math.floor((i / count) * source.length))] ?? 0
    } else {
      const x = i / count
      const tilt = Math.pow(1 - x, 1.3) * 0.8 + 0.06
      target =
        tilt * (0.3 + 0.7 * noise(i * 0.33, f.time * (1 + 2 * f.energy))) * (0.3 + 0.7 * f.energy)
      target += kick * (x < 0.14 ? 0.6 : x < 0.3 ? 0.22 : 0.05) * (0.3 + f.energy)
      target += hat * (x > 0.6 ? 0.28 : 0) * f.energy
    }
    if (!f.playing) target = 0.02
    const current = out[i] ?? 0
    out[i] = current + (target - current) * (target > current ? 0.55 : 0.12)
  }
  return out
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  x: number,
  y: number,
  size: number,
  radius: number,
): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 30
  ctx.shadowOffsetY = 12
  roundRect(ctx, x, y, size, size, radius)
  ctx.fillStyle = '#000'
  ctx.fill()
  ctx.restore()
  ctx.save()
  roundRect(ctx, x, y, size, size, radius)
  ctx.clip()
  if (f.cover) ctx.drawImage(f.cover, x, y, size, size)
  else {
    const fill = ctx.createLinearGradient(x, y, x + size, y + size)
    fill.addColorStop(0, rgba(f.palette[0], 1))
    fill.addColorStop(1, rgba(f.palette[2], 1))
    ctx.fillStyle = fill
    ctx.fillRect(x, y, size, size)
  }
  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** Smooth value noise, for the stand-in spectrum's wander. */
function noise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
