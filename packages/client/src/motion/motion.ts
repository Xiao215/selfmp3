import type { Motion } from '@selfmp3/shared'

/**
 * A song's motion curve, ready to be read sixty times a second.
 *
 * The server sends it as base64 (schemas/motion.ts); a visual wants plain
 * bytes it can index without allocating, so it is decoded once, when it
 * arrives, and sampled against the playhead every frame after that.
 *
 * No `atob`, no `Buffer`: this package compiles without the DOM and runs on a
 * phone, so the base64 decoder is the dozen lines below.
 */
export interface MotionCurve {
  /** Frames per second. */
  readonly rate: number
  /** Seconds covered. */
  readonly duration: number
  /** One byte per frame, 0–255: quiet to loud. */
  readonly loudness: Uint8Array
  /** One byte per frame, 0–255: how hard something just hit. */
  readonly onset: Uint8Array
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Each character's six bits, or -1; `-` and `_` read as their URL-safe selves too. */
const SEXTETS: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i
  table['-'.charCodeAt(0)] = 62
  table['_'.charCodeAt(0)] = 63
  return table
})()

/** Base64 to bytes. Padding, whitespace and anything else outside the alphabet are skipped. */
export function base64ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4))
  let length = 0
  let buffer = 0
  let bits = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const value = code < 128 ? (SEXTETS[code] ?? -1) : -1
    if (value < 0) continue
    buffer = ((buffer << 6) | value) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[length++] = (buffer >> bits) & 0xff
    }
  }
  return out.subarray(0, length)
}

export function decodeMotion(motion: Motion): MotionCurve {
  return {
    rate: motion.rate,
    duration: motion.duration,
    loudness: base64ToBytes(motion.loudness),
    onset: base64ToBytes(motion.onset),
  }
}

const SILENT = { level: 0, onset: 0 } as const

/**
 * Level 0–1 and onset 0–1 at a time, linearly interpolated between frames;
 * 0 past the end, and for a curve with nothing in it. A time before the start
 * reads the first frame.
 */
export function sampleMotion(
  curve: MotionCurve,
  seconds: number,
): { level: number; onset: number } {
  const frames = Math.min(curve.loudness.length, curve.onset.length)
  if (frames === 0 || !(curve.rate > 0) || !Number.isFinite(seconds)) return { ...SILENT }
  const position = Math.max(0, seconds) * curve.rate
  const index = Math.floor(position)
  if (index >= frames) return { ...SILENT }

  const next = Math.min(index + 1, frames - 1)
  const t = position - index
  const at = (bytes: Uint8Array): number => {
    const a = bytes[index] ?? 0
    const b = bytes[next] ?? 0
    return (a + (b - a) * t) / 255
  }
  return { level: at(curve.loudness), onset: at(curve.onset) }
}
