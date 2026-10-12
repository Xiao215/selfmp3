/**
 * How songs sound, as the server's listening model heard them, read on a
 * device (docs/features/audio-intelligence.md, docs/features/listen-together.md).
 *
 * The server writes every song's vector into one pack in the bucket
 * (`snapshot.sound`, apps/server's sound/pack.ts):
 *
 *   4 bytes   header length, uint32 little-endian
 *   header    JSON { model, dimensions, heard: [audio key…], unhearable: [audio key…] }
 *   vectors   one per `heard` key, in order, `dimensions` float32 little-endian each
 *
 * Every vector is unit length, so a dot product is how alike two songs sound.
 * A listening room carries a song's vector packed small — one signed byte per
 * dimension, in base64 — which keeps 768 numbers to about a kilobyte and ranks
 * songs the same way to within a rounding.
 */

/** Dimensions of the listening model's vectors: what a pack and a packed vector must have. */
export const SOUND_DIMENSIONS = 768

/** A pack's vectors, by each song's audio key; null for a pack this cannot read. */
export function decodeSoundPack(
  bytes: Uint8Array,
): { model: string; vectors: Map<string, Float32Array> } | null {
  if (bytes.length < 4) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerLength = view.getUint32(0, true)
  if (4 + headerLength > bytes.length) return null
  let header: unknown
  try {
    // The header is ASCII: a model's name and audio keys, which are hashes.
    let text = ''
    for (let index = 4; index < 4 + headerLength; index++) {
      text += String.fromCharCode(bytes[index] ?? 0)
    }
    header = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof header !== 'object' || header === null) return null
  const { model, dimensions, heard } = header as Record<string, unknown>
  if (typeof model !== 'string' || dimensions !== SOUND_DIMENSIONS || !Array.isArray(heard)) {
    return null
  }
  const keys = heard.filter((key): key is string => typeof key === 'string')
  const start = 4 + headerLength
  if (bytes.length !== start + keys.length * SOUND_DIMENSIONS * 4) return null
  const vectors = new Map<string, Float32Array>()
  keys.forEach((key, at) => {
    const vector = new Float32Array(SOUND_DIMENSIONS)
    const offset = start + at * SOUND_DIMENSIONS * 4
    for (let dimension = 0; dimension < SOUND_DIMENSIONS; dimension++) {
      vector[dimension] = view.getFloat32(offset + dimension * 4, true)
    }
    vectors.set(key, vector)
  })
  return { model, vectors }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** A unit vector, small: one signed byte per dimension, in base64. */
export function packVector(vector: ArrayLike<number>): string {
  const bytes = new Uint8Array(vector.length)
  for (let index = 0; index < vector.length; index++) {
    const scaled = Math.round(Math.max(-1, Math.min(1, vector[index] ?? 0)) * 127)
    bytes[index] = scaled & 0xff
  }
  let text = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0
    const b = bytes[index + 1] ?? 0
    const c = bytes[index + 2] ?? 0
    const triple = (a << 16) | (b << 8) | c
    text += ALPHABET[(triple >> 18) & 63]
    text += ALPHABET[(triple >> 12) & 63]
    text += index + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : '='
    text += index + 2 < bytes.length ? ALPHABET[triple & 63] : '='
  }
  return text
}

/** A packed vector back, or null for text that is not one of the right length. */
export function unpackVector(text: string): Int8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return null
  const bytes: number[] = []
  for (let index = 0; index < text.length; index += 4) {
    const values = [0, 1, 2, 3].map(at => ALPHABET.indexOf(text[index + at] ?? '='))
    const triple =
      ((values[0] ?? 0) << 18) |
      ((values[1] ?? 0) << 12) |
      ((Math.max(0, values[2] ?? 0) & 63) << 6) |
      (Math.max(0, values[3] ?? 0) & 63)
    bytes.push((triple >> 16) & 0xff)
    if (text[index + 2] !== '=') bytes.push((triple >> 8) & 0xff)
    if (text[index + 3] !== '=') bytes.push(triple & 0xff)
  }
  if (bytes.length !== SOUND_DIMENSIONS) return null
  return new Int8Array(bytes)
}

/** How alike two packed vectors sound: their dot product, about −1 to 1. */
export function soundCloseness(a: Int8Array, b: Int8Array): number {
  let sum = 0
  for (let index = 0; index < a.length; index++) sum += (a[index] ?? 0) * (b[index] ?? 0)
  return sum / (127 * 127)
}

/** Where several songs sound, together: the mean of their packed vectors, packed again. */
export function soundCentre(vectors: readonly Int8Array[]): Int8Array | null {
  if (vectors.length === 0) return null
  const sums = new Float64Array(SOUND_DIMENSIONS)
  for (const vector of vectors) {
    for (let index = 0; index < SOUND_DIMENSIONS; index++) {
      sums[index] = (sums[index] ?? 0) + (vector[index] ?? 0)
    }
  }
  const centre = new Int8Array(SOUND_DIMENSIONS)
  for (let index = 0; index < SOUND_DIMENSIONS; index++) {
    centre[index] = Math.round((sums[index] ?? 0) / vectors.length)
  }
  return centre
}
