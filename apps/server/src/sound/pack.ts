import { CloudAudioSchema } from '@selfmp3/shared'
import { z } from 'zod'
import { SOUND_DIMENSIONS } from './vectors.js'

/**
 * Every song's sound vector as one file, for the bucket (`soundVectorsKey`,
 * docs/SYNC.md):
 *
 *   4 bytes   the header's length, little-endian
 *   header    JSON: { model, dimensions, heard: [audio key…], unhearable: [audio key…] }
 *   vectors   one per `heard` key, in its order: `dimensions` float32s, little-endian
 *
 * The vectors are the database's own bytes (`toBlob`), so what comes back is
 * exactly what went up. Songs are named by their audio's key rather than their
 * uid: a vector is how one audio file sounds, and a song given new audio is
 * heard again. Keys are sorted, so the same vectors always make the same file.
 */

/** One song's say: its vector's bytes, or null for a song that could not be heard. */
export interface SoundPackEntry {
  readonly audioKey: string
  readonly vector: Buffer | null
}

const HeaderSchema = z.object({
  model: z.string().min(1),
  dimensions: z.number().int().positive(),
  heard: z.array(CloudAudioSchema.shape.key),
  unhearable: z.array(CloudAudioSchema.shape.key),
})

const VECTOR_BYTES = SOUND_DIMENSIONS * 4

export function encodePack(model: string, entries: Iterable<SoundPackEntry>): Buffer {
  const byKey = new Map<string, Buffer | null>()
  for (const entry of entries) {
    // Two songs with the same audio sound the same: one entry does for both.
    if (!byKey.has(entry.audioKey)) byKey.set(entry.audioKey, entry.vector)
  }
  const keys = [...byKey.keys()].sort()
  const heard = keys.filter(key => byKey.get(key)?.length === VECTOR_BYTES)
  const unhearable = keys.filter(key => byKey.get(key) === null)
  const header = Buffer.from(
    JSON.stringify({ model, dimensions: SOUND_DIMENSIONS, heard, unhearable }),
  )
  const length = Buffer.alloc(4)
  length.writeUInt32LE(header.length)
  return Buffer.concat([length, header, ...heard.map(key => byKey.get(key)!)])
}

/** The file read back; null when it is not one this build can read. */
export function decodePack(data: Buffer): { model: string; entries: SoundPackEntry[] } | null {
  if (data.length < 4) return null
  const headerEnd = 4 + data.readUInt32LE(0)
  if (headerEnd > data.length) return null
  let header: z.infer<typeof HeaderSchema>
  try {
    header = HeaderSchema.parse(JSON.parse(data.subarray(4, headerEnd).toString('utf8')))
  } catch {
    return null
  }
  if (header.dimensions !== SOUND_DIMENSIONS) return null
  if (data.length !== headerEnd + header.heard.length * VECTOR_BYTES) return null
  const entries: SoundPackEntry[] = header.heard.map((audioKey, index) => {
    const start = headerEnd + index * VECTOR_BYTES
    return { audioKey, vector: Buffer.from(data.subarray(start, start + VECTOR_BYTES)) }
  })
  for (const audioKey of header.unhearable) entries.push({ audioKey, vector: null })
  return { model: header.model, entries }
}
