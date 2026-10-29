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

/** The file read back, by audio key; null when it is not one this build reads. */
export function parseSoundMap(text: string): Map<string, MapPlace> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const rows = (parsed as { places?: unknown } | null)?.places
  if (!Array.isArray(rows)) return null
  const places = new Map<string, MapPlace>()
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3) return null
    const [key, x, y] = row as unknown[]
    if (typeof key !== 'string' || !isStep(x) || !isStep(y)) return null
    places.set(key, { x: x / STEPS, y: y / STEPS })
  }
  return places
}

function isStep(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= STEPS
}
