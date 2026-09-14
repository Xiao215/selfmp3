import {
  SONG_FIELDS,
  compareChanges,
  fromCloudRules,
  hlcTime,
  hlcWins,
  parseHlc,
  toSqliteTime,
  type Change,
  type CloudSmartRules,
  type SmartRules,
  type UpdatePlaylist,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import type { Logger } from '../logger.js'
import type { ImportRequestRepository } from '../repositories/importRequests.js'
import type { PlaylistRepository } from '../repositories/playlists.js'
import type { SongRepository } from '../repositories/songs.js'
import type { StatsRepository } from '../repositories/stats.js'
import type { SyncRepository } from '../repositories/sync.js'
import type { TagRepository } from '../repositories/tags.js'
import { sqliteTime } from '../repositories/stats.js'
import type { SyncClock } from './localEdits.js'

/**
 * Other devices' changes, applied to this Mac's database (docs/SYNC.md).
 *
 * The rules are the ones every device replays with (packages/shared/src/
 * sync.ts), followed step for step against SQLite instead of against a
 * snapshot in memory: the latest stamp wins each field, a tag on a song or a
 * song in a playlist is on or off by its latest change, removing is for good,
 * and plays only add up. cloudIngest.test.ts holds the two to the same library
 * from the same changes.
 */

export interface IngestResult {
  /** Changes that changed something here. */
  readonly applied: number
  /**
   * Songs another device removed. What is derived from them — cover, cached
   * lyrics, search index — goes with the row either way; the audio itself only
   * when `deleteFile` says the person asked for that.
   */
  readonly removed: readonly {
    readonly id: number
    readonly path: string
    readonly deleteFile: boolean
  }[]
  /** Links other devices asked this Mac to import, seen for the first time. */
  readonly requested: number
}

export class CloudIngest {
  readonly #db: Db
  readonly #songs: SongRepository
  readonly #tags: TagRepository
  readonly #playlists: PlaylistRepository
  readonly #stats: StatsRepository
  readonly #sync: SyncRepository
  readonly #requests: ImportRequestRepository | null
  readonly #clock: SyncClock
  readonly #logger: Logger

  constructor(deps: {
    db: Db
    songs: SongRepository
    tags: TagRepository
    playlists: PlaylistRepository
    stats: StatsRepository
    sync: SyncRepository
    /** Where link requests go; without it they are left for a Mac that has one. */
    requests?: ImportRequestRepository
    clock: SyncClock
    logger: Logger
  }) {
    this.#db = deps.db
    this.#songs = deps.songs
    this.#tags = deps.tags
    this.#playlists = deps.playlists
    this.#stats = deps.stats
    this.#sync = deps.sync
    this.#requests = deps.requests ?? null
    this.#clock = deps.clock
    this.#logger = deps.logger.child('ingest')
  }

  /**
   * Apply changes in stamp order, all in one transaction with `alongside` —
   * which is where the caller moves its log cursors, so they move with the
   * changes they cover or not at all.
   *
   * One change that cannot be applied (a bug, a database that disagrees) is
   * logged and skipped rather than rolling the rest back: otherwise the same
   * file would fail the same way on every pass, and nothing after it would
   * ever arrive.
   */
  apply(changes: readonly Change[], alongside: () => void = () => undefined): IngestResult {
    const removed: { id: number; path: string; deleteFile: boolean }[] = []
    let applied = 0
    let requested = 0
    this.#db.transaction(() => {
      for (const change of [...changes].sort(compareChanges)) {
        this.#clock.observe(change.hlc)
        try {
          // Nested, so a change that fails rolls back to here and no further.
          if (this.#db.transaction(() => this.#applyOne(change, removed))()) {
            applied++
            if (change.type === 'importRequested') requested++
          }
        } catch (error) {
          this.#logger.warn(`could not apply a ${change.type} change from another device`, {
            uid: change.uid,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      alongside()
    })()
    return { applied, removed, requested }
  }

  #applyOne(
    change: Change,
    removed: { id: number; path: string; deleteFile: boolean }[],
  ): boolean {
    switch (change.type) {
      case 'songEdited': {
        const id = this.#sync.songId(change.uid)
        if (id === null) return false
        const patch: Record<string, unknown> = {}
        for (const field of SONG_FIELDS) {
          const value = change.fields[field]
          if (value === undefined) continue
          if (!hlcWins(change.hlc, this.#sync.stamp('song', change.uid, field))) continue
          patch[field] = value
          this.#sync.setStamp('song', change.uid, field, change.hlc)
        }
        if (Object.keys(patch).length === 0) return false
        this.#songs.patch(id, patch)
        return true
      }

      case 'songTagged': {
        const songId = this.#sync.songId(change.uid)
        const tag = this.#sync.tag(change.tagUid)
        if (songId === null || !tag) return false
        if (!hlcWins(change.hlc, this.#sync.stamp('songTag', change.uid, tag.uid))) return false
        if (change.on) this.#tags.addToSong(songId, tag.id)
        else this.#tags.removeFromSong(songId, tag.id)
        this.#sync.setStamp('songTag', change.uid, tag.uid, change.hlc)
        return true
      }

      case 'songRemoved': {
        const id = this.#sync.songId(change.uid)
        const song = id === null ? null : this.#songs.byId(id)
        if (id === null || !song) return false
        this.#songs.delete(id)
        // The audio only goes if that is what was asked for. The device that
        // removed it offered the choice; this is the other half of it.
        removed.push({ id, path: song.path, deleteFile: change.deleteFile })
        return true
      }

      case 'songPlayed': {
        const id = this.#sync.songId(change.uid)
        if (id === null) return false
        const playedAt = sqliteTime(change.playedAt)
        const counted = this.#stats.record(
          id,
          change.msPlayed,
          change.completed,
          playedAt,
          change.playId,
        )
        if (counted) this.#songs.recordPlay(id, playedAt)
        return counted
      }

      case 'songSkipped': {
        const id = this.#sync.songId(change.uid)
        if (id === null || !this.#sync.countSkip(change.skipId)) return false
        this.#songs.recordSkip(id)
        return true
      }

      case 'tagCreated': {
        if (this.#sync.tag(change.uid)) return false
        // Made on two devices under one name before either heard of the
        // other: one tag, with the second uid kept to find it by.
        const same = this.#sync.tagNamed(change.name)
        if (same) this.#sync.addAlias(change.uid, same.id)
        else this.#tags.insertSynced(change.uid, change.name, change.hue)
        return true
      }

      case 'tagEdited': {
        const tag = this.#sync.tag(change.uid)
        if (!tag) return false
        const update: { name?: string; hue?: number } = {}
        const { name, hue } = change.fields
        if (name !== undefined && hlcWins(change.hlc, this.#sync.stamp('tag', tag.uid, 'name'))) {
          // A name another tag has is left alone, as the table requires.
          const same = this.#sync.tagNamed(name)
          if (!same || same.id === tag.id) {
            update.name = name
            this.#sync.setStamp('tag', tag.uid, 'name', change.hlc)
          }
        }
        if (hue !== undefined && hlcWins(change.hlc, this.#sync.stamp('tag', tag.uid, 'hue'))) {
          update.hue = hue
          this.#sync.setStamp('tag', tag.uid, 'hue', change.hlc)
        }
        if (Object.keys(update).length === 0) return false
        this.#tags.update(tag.id, update)
        return true
      }

      case 'tagRemoved': {
        const tag = this.#sync.tag(change.uid)
        if (!tag) return false
        // Its aliases, its place on songs and its stamps go with it.
        this.#tags.delete(tag.id)
        return true
      }

      case 'playlistCreated': {
        if (this.#sync.playlist(change.uid)) return false
        this.#playlists.insertSynced({
          uid: change.uid,
          name: change.name,
          description: change.description,
          kind: change.kind,
          rules: change.kind === 'live' && change.rules ? this.#localRules(change.rules) : null,
          pinned: change.pinned,
          createdAt: toSqliteTime(hlcTime(change.hlc)),
        })
        return true
      }

      case 'playlistEdited': {
        const playlist = this.#sync.playlist(change.uid)
        if (!playlist) return false
        const update: UpdatePlaylist = {}
        for (const field of ['name', 'description', 'rules', 'pinned'] as const) {
          const value = change.fields[field]
          if (value === undefined) continue
          if (!hlcWins(change.hlc, this.#sync.stamp('playlist', change.uid, field))) continue
          if (field === 'rules') {
            update.rules = change.fields.rules ? this.#localRules(change.fields.rules) : null
          } else if (field === 'pinned') {
            update.pinned = change.fields.pinned
          } else {
            update[field] = change.fields[field]
          }
          this.#sync.setStamp('playlist', change.uid, field, change.hlc)
        }
        if (Object.keys(update).length === 0) return false
        this.#playlists.update(playlist.id, update)
        this.#dated(playlist, change.hlc)
        return true
      }

      case 'playlistRemoved': {
        const playlist = this.#sync.playlist(change.uid)
        if (!playlist) return false
        this.#playlists.delete(playlist.id)
        return true
      }

      case 'playlistSong': {
        const playlist = this.#sync.playlist(change.uid)
        const songId = this.#sync.songId(change.songUid)
        if (!playlist || playlist.kind !== 'manual' || songId === null) return false
        const stamp = this.#sync.stamp('playlistSong', change.uid, change.songUid)
        if (!hlcWins(change.hlc, stamp)) return false
        if (change.on) this.#playlists.add(playlist.id, [songId])
        else this.#playlists.remove(playlist.id, songId)
        this.#sync.setStamp('playlistSong', change.uid, change.songUid, change.hlc)
        this.#dated(playlist, change.hlc)
        return true
      }

      case 'importRequested': {
        if (!this.#requests) return false
        return this.#requests.record({
          uid: change.uid,
          url: change.url,
          tagUids: change.tagUids,
          playlistUid: change.playlistUid,
          requestedBy: parseHlc(change.hlc)?.device ?? 'unknown',
          requestedAt: toSqliteTime(hlcTime(change.hlc)),
        })
      }

      case 'importCancelled':
        return this.#requests?.cancel(change.uid, toSqliteTime(hlcTime(change.hlc))) ?? false

      case 'playlistOrdered': {
        const playlist = this.#sync.playlist(change.uid)
        if (!playlist || playlist.kind !== 'manual') return false
        if (!hlcWins(change.hlc, this.#sync.stamp('playlist', change.uid, 'order'))) return false
        const songIds = change.songUids.flatMap(uid => {
          const id = this.#sync.songId(uid)
          return id === null ? [] : [id]
        })
        this.#playlists.reorder(playlist.id, songIds)
        this.#sync.setStamp('playlist', change.uid, 'order', change.hlc)
        this.#dated(playlist, change.hlc)
        return true
      }
    }
  }

  /** Rules with each tag named by this Mac's id for it. */
  #localRules(rules: CloudSmartRules): SmartRules {
    return fromCloudRules(rules, uid => this.#sync.tag(uid)?.id ?? null)
  }

  /** Dated by when the change was made, not when it arrived — and never back in time. */
  #dated(playlist: { id: number; updatedAt: string }, hlc: string): void {
    const stamped = toSqliteTime(hlcTime(hlc))
    this.#playlists.setUpdatedAt(
      playlist.id,
      stamped > playlist.updatedAt ? stamped : playlist.updatedAt,
    )
  }
}
