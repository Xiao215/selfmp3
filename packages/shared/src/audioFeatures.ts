import type { Song } from './schemas/song.js'
import type { SongFeatures } from './schemas/audioFeatures.js'

/**
 * Pure helpers over audio features: the Camelot wheel, distances between
 * songs, and how long a transition between two of them should be.
 *
 * Shared because both sides need the same answers — the server ranks
 * "similar songs" with these, and the web app orders the queue with them,
 * offline, without a round trip.
 */

/**
 * Bump when the analysis algorithm changes enough that old rows should be redone.
 * 3: analysis also writes each song's motion curve (schemas/motion.ts), so every
 * song analysed before it is analysed once more to gain one.
 */
export const ANALYSIS_VERSION = 3

export const PITCH_NAMES = [
  'C',
  'C♯',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
] as const

export type KeyMode = 'major' | 'minor'

/** "A minor", "F♯ major". */
export function keyName(pitchClass: number, mode: KeyMode): string {
  const name = PITCH_NAMES[((pitchClass % 12) + 12) % 12] ?? 'C'
  return `${name} ${mode}`
}

/**
 * Camelot code for a key.
 *
 * The wheel is the circle of fifths with C major at 8B. Each step clockwise
 * is a fifth (adds one to the number), and a minor key shares its number with
 * its relative major — A minor is 8A because C major is 8B.
 */
export function camelotFromKey(pitchClass: number, mode: KeyMode): string {
  const pc = ((pitchClass % 12) + 12) % 12
  const majorPc = mode === 'major' ? pc : (pc + 3) % 12
  // Position on the circle of fifths, then rotate so C lands on 8.
  const fifths = (majorPc * 7) % 12
  const number = ((fifths + 7) % 12) + 1
  return `${number}${mode === 'major' ? 'B' : 'A'}`
}

export function parseCamelot(code: string): { number: number; letter: 'A' | 'B' } | null {
  const match = /^(1[0-2]|[1-9])([AB])$/.exec(code.trim().toUpperCase())
  if (!match) return null
  return { number: Number(match[1]), letter: match[2] === 'A' ? 'A' : 'B' }
}

/**
 * Distance around the Camelot wheel, 0–7.
 *
 * Same code is 0. The three classic harmonic mixes (same number other letter,
 * ±1 same letter) are 1. Anything further adds one per step around the wheel
 * plus one for switching between major and minor.
 */
export function camelotDistance(a: string, b: string): number {
  const x = parseCamelot(a)
  const y = parseCamelot(b)
  if (!x || !y) return 7
  const around = Math.abs(x.number - y.number)
  const steps = Math.min(around, 12 - around)
  return steps + (x.letter === y.letter ? 0 : 1)
}

/** Every code that mixes cleanly with `code`, including itself. */
export function compatibleCamelot(code: string): string[] {
  const parsed = parseCamelot(code)
  if (!parsed) return []
  const { number, letter } = parsed
  const up = (number % 12) + 1
  const down = ((number + 10) % 12) + 1
  return [
    `${number}${letter}`,
    `${number}${letter === 'A' ? 'B' : 'A'}`,
    `${up}${letter}`,
    `${down}${letter}`,
  ]
}

/**
 * Relative tempo gap, 0 when the tempos match to within 8%.
 *
 * Double- and half-time count as a match: 70 and 140 BPM sit together on a
 * dance floor, and the analyser itself sometimes picks the other octave.
 * Beyond the tolerance the result is the fractional gap (0.2 = 20% apart).
 */
export function bpmDistance(a: number, b: number, tolerance = 0.08): number {
  if (!(a > 0) || !(b > 0)) return 1
  let best = Infinity
  for (const ratio of [1, 2, 0.5]) {
    const gap = Math.abs(a * ratio - b) / b
    if (gap < best) best = gap
  }
  return best <= tolerance ? 0 : Math.min(1, best)
}

export interface FeatureWeights {
  readonly bpm: number
  readonly energy: number
  readonly loudness: number
  readonly key: number
}

export const DEFAULT_WEIGHTS: FeatureWeights = { bpm: 1, energy: 1, loudness: 0.5, key: 1 }

/**
 * Weighted distance between two feature sets, roughly 0–4 with default
 * weights. A missing value on either side scores as a middling mismatch,
 * so un-analysed songs sink rather than either dominating or vanishing.
 */
export function featureDistance(
  a: SongFeatures | null,
  b: SongFeatures | null,
  weights: FeatureWeights = DEFAULT_WEIGHTS,
): number {
  const unknown = 0.5

  const bpm = a?.bpm != null && b?.bpm != null ? bpmDistance(a.bpm, b.bpm) : unknown
  const energy = a?.energy != null && b?.energy != null ? Math.abs(a.energy - b.energy) : unknown
  // 10 LU apart is a big difference; normalise on that scale.
  const loudness =
    a?.loudnessLufs != null && b?.loudnessLufs != null
      ? Math.min(1, Math.abs(a.loudnessLufs - b.loudnessLufs) / 10)
      : unknown
  const key =
    a?.camelot != null && b?.camelot != null ? camelotDistance(a.camelot, b.camelot) / 7 : unknown

  return (
    weights.bpm * bpm + weights.energy * energy + weights.loudness * loudness + weights.key * key
  )
}

/**
 * Full song-to-song distance for "similar songs": features, plus a bonus for
 * shared tags (the user's own judgement about what goes together) and a
 * milder one for the same artist. Lower is more similar.
 */
export function songDistance(seed: Song, candidate: Song): number {
  let distance = featureDistance(seed.features, candidate.features)

  const seedTags = new Set(seed.tagIds)
  let shared = 0
  for (const tagId of candidate.tagIds) if (seedTags.has(tagId)) shared++
  // Each shared tag is worth about as much as a perfect BPM match, capped so a
  // heavily tagged pair cannot override every acoustic mismatch.
  distance -= Math.min(shared, 3) * 0.35

  if (seed.artist && seed.artist.toLowerCase() === candidate.artist.toLowerCase()) {
    distance -= 0.25
  }

  return distance
}

/**
 * How long the crossfade between two songs should run.
 *
 * Close tempos and compatible keys blend, so they get the full length; a
 * clash gets a short fade so the mismatch is over quickly. `maxSeconds` is
 * the user's ceiling and is never exceeded.
 */
export function transitionCrossfade(
  from: SongFeatures | null,
  to: SongFeatures | null,
  maxSeconds: number,
): number {
  const max = Math.max(0, maxSeconds)
  if (max === 0) return 0
  if (!from || !to) return Math.min(max, Math.max(2, Math.round(max * 0.5)))

  const bpm = from.bpm != null && to.bpm != null ? bpmDistance(from.bpm, to.bpm) : 0.5
  const key =
    from.camelot != null && to.camelot != null ? camelotDistance(from.camelot, to.camelot) : 3

  // 1 when everything lines up, falling toward 0 as tempo and key diverge.
  // Any harmonically compatible key (distance ≤ 1) counts as a full match.
  const fit =
    (1 - Math.min(1, bpm / 0.25)) * 0.6 + (1 - Math.min(1, Math.max(0, key - 1) / 3)) * 0.4
  const seconds = 2 + (max - 2) * fit
  return Math.max(1, Math.min(max, Math.round(seconds)))
}

/**
 * Nearest neighbours for "similar songs".
 *
 * A brute-force pass over the library: with a few thousand songs and a
 * distance that is a handful of subtractions, this is microseconds, and an
 * index would be more code than the feature. Missing files are left out —
 * a recommendation you cannot play is worse than none.
 */
export function similarSongs(seed: Song, library: readonly Song[], limit: number): Song[] {
  const scored: Array<{ song: Song; distance: number }> = []

  for (const candidate of library) {
    if (candidate.id === seed.id || candidate.missing) continue
    scored.push({ song: candidate, distance: songDistance(seed, candidate) })
  }

  scored.sort((a, b) => a.distance - b.distance || a.song.id - b.song.id)
  return scored.slice(0, Math.max(0, limit)).map(entry => entry.song)
}
