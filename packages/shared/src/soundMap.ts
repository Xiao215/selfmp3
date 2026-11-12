/**
 * The sound map's file in the bucket (docs/features/sound-map.md,
 * `soundMapKey`): where every heard song sits, as the server folded the sound
 * vectors down to two numbers.
 *
 *   { "places": [["audio/<sha256>.m4a", x, y], …] }
 *
 * Songs are named by their audio's key, as the vectors are: a place is where
 * one recording sounds. `x` and `y` are whole numbers from 0 to 10 000 (left to
 * right, top to bottom), which keeps 1,500 songs to about 120 KB, read once a
 * change. Keys are sorted, so the same map is always the same file.
 */

import { z } from 'zod'

/** A song's place on the map, 0–1 across and down. */
export interface MapPlace {
  readonly x: number
  readonly y: number
}

const STEPS = 10_000

export function encodeSoundMap(places: ReadonlyMap<string, MapPlace>): string {
  const rows = [...places.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, place]) => [key, Math.round(place.x * STEPS), Math.round(place.y * STEPS)])
  return JSON.stringify({ places: rows })
}

const StepSchema = z.number().int().min(0).max(STEPS)
const SoundMapFileSchema = z.object({
  places: z.array(z.tuple([z.string(), StepSchema, StepSchema])),
})

/** The file read back, by audio key; null when it is not one this build reads. */
export function parseSoundMap(text: string): Map<string, MapPlace> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const file = SoundMapFileSchema.safeParse(parsed)
  if (!file.success) return null
  return new Map(file.data.places.map(([key, x, y]) => [key, { x: x / STEPS, y: y / STEPS }]))
}
