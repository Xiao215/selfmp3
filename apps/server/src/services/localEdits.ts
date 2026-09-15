import { HlcClock, type SongFields } from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import type { SyncRepository } from '../repositories/sync.js'

/**
 * This server's clock for stamping changes (packages/shared/src/hlc.ts). Made the
 * first time it is needed, and carrying on from the latest stamp the database
 * holds, so what the server does next comes after everything it has seen — even
 * after a restart with the wall clock set back.
 */
export class SyncClock {
  readonly #deviceId: () => string
  readonly #latest: () => string | null
  readonly #now: () => number
  #clock: HlcClock | null = null

  constructor(deps: { deviceId: () => string; latest: () => string | null; now?: () => number }) {
    this.#deviceId = deps.deviceId
    this.#latest = deps.latest
    this.#now = deps.now ?? Date.now
  }

  tick(): string {
    return this.#get().tick()
  }

  observe(hlc: string): void {
    this.#get().observe(hlc)
  }

  #get(): HlcClock {
    this.#clock ??= new HlcClock(this.#deviceId(), { now: this.#now, last: this.#latest() })
    return this.#clock
  }
}

/**
 * Edits made on this server, stamped as they are made (docs/SYNC.md).
 *
 * Every other device's edits arrive with a stamp saying when they were made,
 * and the latest one wins. An edit made here needs a stamp too, or one made
 * on the phone an hour earlier, arriving now, would replace it. Only fields a
 * person edits are stamped; what the scanner reads from a file is not, so an
 * edit from anywhere replaces it.
 *
 * Nothing is stamped for making or deleting things. A new tag is simply there
 * in the next snapshot, and a deleted one takes its stamps with it (the
 * `sync_stamps_*_delete` triggers in db/migrate.ts).
 */
export class LocalEdits {
  readonly #db: Db
  readonly #sync: SyncRepository
  readonly #clock: SyncClock

  constructor(deps: { db: Db; sync: SyncRepository; clock: SyncClock }) {
    this.#db = deps.db
    this.#sync = deps.sync
    this.#clock = deps.clock
  }

  /** Fields of songs edited by hand. */
  songs(ids: readonly number[], fields: readonly (keyof SongFields)[]): void {
    if (ids.length === 0 || fields.length === 0) return
    this.#stampAll('song', this.#sync.uids('songs', ids).values(), fields)
  }

  /** Tags put on one song, or taken off it. */
  songTags(songId: number, tagIds: readonly number[]): void {
    const song = this.#sync.uids('songs', [songId]).get(songId)
    if (!song || tagIds.length === 0) return
    this.#stampAll('songTag', [song], [...this.#sync.uids('tags', tagIds).values()])
  }

  /** One tag put on, or taken off, many songs. */
  tagOnSongs(tagId: number, songIds: readonly number[]): void {
    const tag = this.#sync.uids('tags', [tagId]).get(tagId)
    if (!tag || songIds.length === 0) return
    const hlc = this.#clock.tick()
    this.#db.transaction(() => {
      for (const song of this.#sync.uids('songs', songIds).values()) {
        this.#sync.setStamp('songTag', song, tag, hlc)
      }
    })()
  }

  tag(id: number, fields: readonly ('name' | 'hue')[]): void {
    this.#stampAll('tag', this.#sync.uids('tags', [id]).values(), fields)
  }

  /** Fields of a playlist, or `order` when its songs were put in a new order. */
  playlist(
    id: number,
    fields: readonly ('name' | 'description' | 'rules' | 'pinned' | 'order')[],
  ): void {
    this.#stampAll('playlist', this.#sync.uids('playlists', [id]).values(), fields)
  }

  /** Songs added to a playlist, or taken out of it. */
  playlistSongs(playlistId: number, songIds: readonly number[]): void {
    const playlist = this.#sync.uids('playlists', [playlistId]).get(playlistId)
    if (!playlist || songIds.length === 0) return
    this.#stampAll('playlistSong', [playlist], [...this.#sync.uids('songs', songIds).values()])
  }

  /** One edit, one stamp, however many things it touched. */
  #stampAll(
    kind: 'song' | 'songTag' | 'tag' | 'playlist' | 'playlistSong',
    uids: Iterable<string>,
    fields: readonly string[],
  ): void {
    const targets = [...uids]
    if (targets.length === 0 || fields.length === 0) return
    const hlc = this.#clock.tick()
    this.#db.transaction(() => {
      for (const uid of targets) {
        for (const field of fields) this.#sync.setStamp(kind, uid, field, hlc)
      }
    })()
  }
}
