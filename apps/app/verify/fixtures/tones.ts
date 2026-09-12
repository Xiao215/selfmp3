import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The two test tones the engine spike plays.
 *
 * Generated rather than committed for two reasons. The repository ignores
 * `*.wav` — it is a music player, and the rule that keeps someone's library out
 * of git is worth more than two fixtures. And two seconds of a sine wave is a
 * few lines of arithmetic, which is easier to trust than a binary nobody can
 * read.
 *
 * WAV rather than MP3 on purpose: an MP3 carries encoder padding at both ends,
 * and a gapless test should measure the engine's handover, not LAME's silence.
 */

const RATE = 44_100
const SECONDS = 2
const AMPLITUDE = 0.3

/** A 16-bit mono PCM WAV of a sine wave at `hz`. */
function tone(hz: number): Buffer {
  const samples = RATE * SECONDS
  const data = Buffer.alloc(samples * 2)

  for (let i = 0; i < samples; i++) {
    // Fade the first and last 5ms so the file does not start or end on a step,
    // which would click and read as a gap the engine did not cause.
    const fade = Math.min(1, i / 220, (samples - i) / 220)
    const value = Math.sin((2 * Math.PI * hz * i) / RATE) * AMPLITUDE * fade
    data.writeInt16LE(Math.round(value * 32_767), i * 2)
  }

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM chunk size
  header.writeUInt16LE(1, 20) // format: PCM
  header.writeUInt16LE(1, 22) // channels
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)

  return Buffer.concat([header, data])
}

const TONES: readonly (readonly [string, number])[] = [
  ['tone-a.wav', 440],
  ['tone-b.wav', 880],
]

/** Writes any tone that is missing. Cheap enough to call before every run. */
export function ensureTones(): void {
  for (const [name, hz] of TONES) {
    const path = join(__dirname, name)
    if (!existsSync(path)) writeFileSync(path, tone(hz))
  }
}
