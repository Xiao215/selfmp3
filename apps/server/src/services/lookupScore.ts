import { editDistance, type MetadataCandidate } from '@selfmp3/shared'

/**
 * Scoring lookup candidates against what the library currently believes.
 *
 * Pure functions, so they are cheap to test and independent of which provider
 * produced the candidate. A score is 0..1; the cover-art pass only trusts
 * candidates at or above `CONFIDENT_SCORE`, while the dialog shows everything
 * and lets the user judge.
 */

export interface LookupQuery {
  readonly title: string
  readonly artist: string
  readonly album: string
  /** Seconds; zero means unknown. */
  readonly duration: number
}

/** Below this the cover-art pass leaves a song alone rather than guessing. */
export const CONFIDENT_SCORE = 0.85

/**
 * Bring a title or artist down to something comparable.
 *
 * Strips accents, case, punctuation and the bracketed noise that download
 * tools and remaster editions add — "Song (Official Video)" and "Song -
 * Remastered 2011" should both match a database entry for "Song".
 */
const NOISE_WORDS =
  'official|video|audio|lyric|lyrics|hd|hq|mv|live|remaster|feat|ft|version|edit|mix'
const BRACKETED_NOISE = new RegExp(`[([][^)\\]]*\\b(?:${NOISE_WORDS})\\b[^)\\]]*[)\\]]`, 'g')
const DASHED_SUFFIX =
  /\s+[-–—]\s+(?:remaster(?:ed)?|live|mono|stereo|single version|radio edit)\b.*$/

export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(BRACKETED_NOISE, ' ')
    .replace(DASHED_SUFFIX, ' ')
    .replace(/\b(?:feat|ft)\.?\s.*$/, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  const padded = ` ${text} `
  for (let i = 0; i < padded.length - 1; i++) {
    const pair = padded.slice(i, i + 2)
    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }
  return counts
}

/** Sørensen–Dice over character bigrams: tolerant of word order and typos. */
function diceSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const left = bigrams(a)
  const right = bigrams(b)
  let overlap = 0
  let leftTotal = 0
  let rightTotal = 0
  for (const [pair, count] of left) {
    leftTotal += count
    overlap += Math.min(count, right.get(pair) ?? 0)
  }
  for (const count of right.values()) rightTotal += count
  return (2 * overlap) / (leftTotal + rightTotal)
}

/**
 * 0..1 similarity between two free-text fields.
 *
 * Exact (after normalisation) is 1. Containment — "Nocturne" inside "Nocturne
 * Study in E" — is high but not perfect. Otherwise bigram overlap, with a
 * small bonus when the edit distance is tiny (a typo rather than a different
 * song).
 */
export function similarity(rawA: string, rawB: string): number {
  const a = normalizeText(rawA)
  const b = normalizeText(rawB)
  if (!a || !b) return 0
  if (a === b) return 1

  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  const contained = longer.includes(shorter) ? 0.85 * (shorter.length / longer.length) + 0.1 : 0

  const dice = diceSimilarity(a, b)
  const distance = editDistance(a, b, 2)
  const typo = distance <= 2 ? 0.95 - distance * 0.1 : 0

  return Math.max(contained, dice, typo)
}

/** 1 when durations agree, falling to 0 at a 20-second difference. */
export function durationCloseness(a: number | undefined, b: number): number | null {
  if (!a || !b) return null
  const delta = Math.abs(a - b)
  if (delta <= 2) return 1
  return Math.max(0, 1 - (delta - 2) / 18)
}

/**
 * Weight title, artist and duration. Fields the song does not have (no
 * artist, unknown duration) hand their weight to the title rather than
 * dragging every candidate down for something the library never knew.
 */
export function scoreCandidate(
  candidate: Pick<MetadataCandidate, 'title' | 'artist' | 'durationSec'>,
  query: LookupQuery,
): number {
  let titleWeight = 0.55
  let artistWeight = 0.3
  let durationWeight = 0.15

  const artistSim = query.artist.trim() ? similarity(candidate.artist, query.artist) : null
  if (artistSim === null) {
    titleWeight += artistWeight
    artistWeight = 0
  }

  const duration = durationCloseness(candidate.durationSec, query.duration)
  if (duration === null) {
    titleWeight += durationWeight
    durationWeight = 0
  }

  const score =
    titleWeight * similarity(candidate.title, query.title) +
    artistWeight * (artistSim ?? 0) +
    durationWeight * (duration ?? 0)

  return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000
}

/** Best-first, de-duplicated on (source, title, artist, album). */
export function rankCandidates(candidates: MetadataCandidate[]): MetadataCandidate[] {
  const seen = new Set<string>()
  const unique: MetadataCandidate[] = []
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const key = [
      candidate.source,
      normalizeText(candidate.title),
      normalizeText(candidate.artist),
      normalizeText(candidate.album),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(candidate)
  }
  return unique
}
