/**
 * The arithmetic around CLaMP 3's sound vectors, with no model in it: which
 * parts of a song are listened to, how a clip is prepared for MERT, how its
 * chunks become the audio encoder's input, and how two vectors compare.
 * Everything here is what `scripts/sound-models` was checked against: change
 * it and the vectors stop meaning what the model learned.
 */

/** Numbers in one sound vector. */
export const SOUND_DIMENSIONS = 768

/** MERT listens at 24 kHz. */
export const SOUND_SAMPLE_RATE = 24_000

/** CLaMP 3 hears a clip in 5 s chunks, one MERT pass each. */
const CHUNK_SAMPLES = 5 * SOUND_SAMPLE_RATE

/** A last chunk shorter than a second is dropped, as CLaMP 3's extractor does. */
const MIN_CHUNK_SAMPLES = SOUND_SAMPLE_RATE

/** Each window heard, in seconds. */
export const WINDOW_SECONDS = 10

/** Where in the song the windows start, as fractions of its length. */
const WINDOW_AT = [0.2, 0.45, 0.7] as const

/**
 * The parts of a song that are heard: three ten-second windows, a fifth, just
 * under half and seven tenths of the way in. They skip the intro and the fade
 * and between them catch a verse, a chorus and whatever comes after, which is
 * what the comparison in the bake-off listened to. A song shorter than the
 * three windows together is heard whole, once.
 */
export function windowStarts(duration: number): number[] {
  if (!(duration > WINDOW_SECONDS * WINDOW_AT.length)) return [0]
  return WINDOW_AT.map(
    at => Math.round(Math.max(0, Math.min(duration - WINDOW_SECONDS, duration * at)) * 100) / 100,
  )
}

/**
 * Wav2Vec2's feature extractor with `do_normalize`: zero mean and unit
 * variance over the whole clip (the windows together), before any chunking.
 */
export function normaliseClip(pcm: Float32Array): Float32Array {
  if (pcm.length === 0) return pcm
  let mean = 0
  for (const value of pcm) mean += value
  mean /= pcm.length
  let variance = 0
  for (const value of pcm) variance += (value - mean) ** 2
  variance /= pcm.length
  const scale = 1 / Math.sqrt(variance + 1e-7)
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = (pcm[i]! - mean) * scale
  return out
}

/** The clip in MERT's 5 s chunks; a last one under a second is left off. */
export function chunks(clip: Float32Array): Float32Array[] {
  const out: Float32Array[] = []
  for (let start = 0; start < clip.length; start += CHUNK_SAMPLES) {
    const chunk = clip.subarray(start, start + CHUNK_SAMPLES)
    if (chunk.length < MIN_CHUNK_SAMPLES) break
    out.push(chunk)
  }
  return out
}

/**
 * The audio encoder's input: one MERT vector per chunk, between two zero
 * frames, as CLaMP 3's extractor lays them out. Returns the flat data and its
 * length in frames.
 */
export function encoderFrames(perChunk: readonly Float32Array[]): {
  data: Float32Array
  frames: number
} {
  const frames = perChunk.length + 2
  const data = new Float32Array(frames * SOUND_DIMENSIONS)
  perChunk.forEach((vector, index) => data.set(vector, (index + 1) * SOUND_DIMENSIONS))
  return { data, frames }
}

/** The vector scaled to length one, so a dot product is the cosine. */
export function unit(vector: ArrayLike<number>): Float32Array {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i]! * vector[i]!
  const scale = sum > 0 ? 1 / Math.sqrt(sum) : 0
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) out[i] = vector[i]! * scale
  return out
}

/** Dot product: the cosine, for two unit vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!
  return sum
}

/** A vector as the bytes SQLite keeps: little-endian float32s. */
export function toBlob(vector: Float32Array): Buffer {
  const out = Buffer.alloc(vector.length * 4)
  for (let i = 0; i < vector.length; i++) out.writeFloatLE(vector[i]!, i * 4)
  return out
}

/** The bytes back into a vector; null when they are not one. */
export function fromBlob(blob: Buffer | null): Float32Array | null {
  if (!blob || blob.length !== SOUND_DIMENSIONS * 4) return null
  const out = new Float32Array(SOUND_DIMENSIONS)
  for (let i = 0; i < SOUND_DIMENSIONS; i++) out[i] = blob.readFloatLE(i * 4)
  return out
}
