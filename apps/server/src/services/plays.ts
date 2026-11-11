import { transact, type Db } from '../db/index.js'
import type { SongRepository } from '../repositories/songs.js'
import { heardMs, impossiblePlay, sqliteTime, type StatsRepository } from '../repositories/stats.js'

interface PlayDeps {
  readonly db: Db
  readonly stats: StatsRepository
  readonly songs: SongRepository
}

/** A play as a device reports it: to this server's route, or in its log (`songPlayed`). */
interface PlayHeard {
  readonly msPlayed: number
  readonly completed: boolean
  readonly playedAt?: string
}

/**
 * Why nobody could have made the play, or whether it counted: false for the
 * same play arriving again.
 */
type PlayOutcome = { readonly impossible: string } | { readonly counted: boolean }

/**
 * A play of a song `duration` seconds long, recorded under the one rule both
 * ways a play arrives are held to: `POST /api/songs/:id/played`, and another
 * device's log replayed (services/cloudIngest.ts).
 *
 * A play nobody could have made is refused (`impossiblePlay`). One sent late
 * carries when it happened; one sent twice carries the same `playId` both
 * times, and one across the same stretch of time as a play of the song
 * already here is that play. Either way the second changes nothing. A play
 * that counts is kept as an event (for history and stats) and on the song's
 * running counter (for smart playlists and sorting).
 */
export function recordPlay(
  deps: PlayDeps,
  songId: number,
  duration: number,
  play: PlayHeard,
  playId: string | null,
): PlayOutcome {
  const impossible = impossiblePlay(play, duration)
  if (impossible) return { impossible }
  const playedAt = sqliteTime(play.playedAt)
  const heard = heardMs(play.msPlayed, duration)
  const counted = transact(deps.db, () => {
    if (deps.stats.overlaps(songId, heard, playedAt, playId)) return false
    const inserted = deps.stats.record(songId, heard, play.completed, playedAt, playId)
    if (inserted) deps.songs.recordPlay(songId, playedAt)
    return inserted
  })
  return { counted }
}
