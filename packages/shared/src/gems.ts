import { gemsThresholdDays } from './schemas/gems.js'
import { fromSqliteTime } from './sync.js'

/**
 * Forgotten gems: songs you clearly liked that have gone quiet.
 *
 * A song qualifies when it is loved or has five or more plays and it has not
 * been played for at least the threshold (a loved song never played counts
 * from the day it was added). Ranking is `plays × days since`, nudged by a
 * random factor between 0.75 and 1.25 so the same handful does not sit at the
 * top forever.
 *
 * One pure function, because the shelf is drawn from two libraries: the
 * server's, in `routes/gems.ts`, and the cloud library a device holds when the
 * server is away, in `packages/replica`. A rule written twice drifts.
 */

/** Below this a song was only ever passing through. */
const MIN_PLAYS = 5

const DAY_MS = 24 * 60 * 60 * 1000

/** What the ranking reads of a song: a `Song` and a `CloudSong` both have it. */
interface GemFields {
  readonly loved: boolean
  readonly playCount: number
  readonly lastPlayedAt: string | null
  readonly addedAt: string
}

interface Gem<S extends GemFields> {
  readonly song: S
  /** Whole days since it was last played, or added if never played. */
  readonly daysSince: number
}

interface ForgottenGemsResult<S extends GemFields> {
  readonly gems: Gem<S>[]
  /** How long a song must have gone unplayed to qualify, in days. */
  readonly minDays: number
  /** How many songs qualified in total, before the limit. */
  readonly total: number
}

/** Days since the first song was added — how old the library is. */
export function libraryAgeDays(songs: readonly GemFields[], now = Date.now()): number {
  if (songs.length === 0) return 0
  const first = Math.min(...songs.map(song => fromSqliteTime(song.addedAt)))
  return Math.max(0, (now - first) / DAY_MS)
}

export function forgottenGems<S extends GemFields>(
  songs: readonly S[],
  options: { limit: number; now?: number; random?: () => number },
): ForgottenGemsResult<S> {
  const now = options.now ?? Date.now()
  const random = options.random ?? Math.random
  const minDays = gemsThresholdDays(libraryAgeDays(songs, now))

  const quiet = songs.flatMap(song => {
    if (!song.loved && song.playCount < MIN_PLAYS) return []
    const daysSince = (now - fromSqliteTime(song.lastPlayedAt ?? song.addedAt)) / DAY_MS
    if (daysSince < minDays) return []
    const score = Math.max(song.playCount, 1) * daysSince * (0.75 + random() * 0.5)
    return [{ song, daysSince: Math.floor(daysSince), score }]
  })

  return {
    gems: quiet
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit)
      .map(({ song, daysSince }) => ({ song, daysSince })),
    minDays,
    total: quiet.length,
  }
}
