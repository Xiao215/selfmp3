import zlib from 'node:zlib'
import { CloudPlaysFileSchema, type CloudPlaysFile } from '@selfmp3/shared'
import type { StatsRepository } from '../repositories/stats.js'
import type { SyncRepository } from '../repositories/sync.js'

/**
 * The library's plays as files in the bucket, a month each
 * (docs/features/shared-server.md, `CloudPlaysFileSchema`).
 *
 * A snapshot carries how often each song was played, never when, and the log
 * a device's play arrives in is tidied away once a snapshot has folded it in.
 * So `play_events` was the only place a play's time survived, and a server's
 * database held history no bucket did. These files are that history; a
 * database made again from the bucket reads them back, and Stats answers as
 * it did.
 *
 * Each play is named in the file by an id that stays its own: the id a device
 * gave it, else this server's device id and the row's. Reading a file twice,
 * or two months that overlap, counts each play once.
 */
export class PlaysArchive {
  readonly #stats: Pick<StatsRepository, 'months' | 'monthPlays' | 'restore'>
  readonly #sync: Pick<SyncRepository, 'songId'>
  readonly #deviceId: () => string

  constructor(deps: {
    stats: Pick<StatsRepository, 'months' | 'monthPlays' | 'restore'>
    sync: Pick<SyncRepository, 'songId'>
    /** This server's name in the bucket, for the plays no device named. */
    deviceId: () => string
  }) {
    this.#stats = deps.stats
    this.#sync = deps.sync
    this.#deviceId = deps.deviceId
  }

  /** Each month with plays here, and what its plays sign as. */
  months(): { month: string; count: number; sig: string }[] {
    return this.#stats.months()
  }

  /**
   * One month as the bucket keeps it: gzipped JSON, the same bytes for the
   * same plays (gzip's header carries no time), so the hash names the plays.
   */
  file(month: string): { body: Buffer; count: number } {
    const device = this.#deviceId()
    const plays: CloudPlaysFile['plays'] = this.#stats
      .monthPlays(month)
      .map(play => [
        play.uid,
        play.playedAt,
        play.msPlayed,
        play.completed,
        play.clientId ?? `${device}-${play.id}`,
      ])
    const file: CloudPlaysFile = { format: 1, month, plays }
    return { body: zlib.gzipSync(JSON.stringify(file)), count: plays.length }
  }

  /**
   * A month's file, read back into this library: the plays of songs it has.
   * Null when the file is not one this build reads.
   */
  restore(data: Buffer): { month: string; restored: number } | null {
    let parsed: CloudPlaysFile
    try {
      const text = (data[0] === 0x1f ? zlib.gunzipSync(data) : data).toString('utf8')
      parsed = CloudPlaysFileSchema.parse(JSON.parse(text))
    } catch {
      return null
    }
    const plays = []
    for (const [uid, playedAt, msPlayed, completed, id] of parsed.plays) {
      const songId = this.#sync.songId(uid)
      // A song since removed took its plays with it, here as everywhere.
      if (songId !== null) plays.push({ songId, playedAt, msPlayed, completed, id })
    }
    return { month: parsed.month, restored: this.#stats.restore(plays) }
  }
}
