import path from 'node:path'
import {
  fromCloudRules,
  sanitizeFilename,
  type CloudPlaylist,
  type CloudSnapshot,
  type CloudSong,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import type { Logger } from '../logger.js'
import type { StorageDriver } from '../storage/index.js'
import type { AudioFeaturesRepository } from '../repositories/audioFeatures.js'
import type { CloudRepository } from '../repositories/cloud.js'
import type { PlaylistRepository } from '../repositories/playlists.js'
import type { SongRepository } from '../repositories/songs.js'
import type { SyncRepository } from '../repositories/sync.js'
import type { TagRepository } from '../repositories/tags.js'
import { isFreeOnDisk, songKeyCandidates } from './libraryLayout.js'
import type { SyncClock } from './localEdits.js'

/**
 * Taking on the library that is already in the bucket (docs/SYNC.md).
 *
 * Until now the server only ever *wrote* snapshots. That is fine for the server
 * that filled the bucket and wrong for every other one: a fresh install signing
 * in to an account with 52 songs in it held nothing, published nothing as the
 * whole library, and every device followed it. The guard in cloudSnapshot.ts
 * stops that happening now — but stopping is not an answer either, because
 * "set self.mp3 up on a new Mac and get my library back" is the same shape.
 *
 * So before a server publishes for the first time into a bucket that has a
 * library, it reads that library and takes on every song in it that it does not
 * have. The row it makes is a whole song — its uid, its tags, its playlists,
 * its plays, its stamps — with `missing` set, because the audio is in the
 * bucket and not on this disk. What was uploaded for it is written to
 * `cloud_songs` from the snapshot, so the next publish re-emits exactly the
 * song it was handed instead of trying to upload files that are already up
 * there.
 *
 * Adoption only ever *adds*. A song this server already has under the same uid
 * is left alone, field for field: the bucket's snapshot is not a change with a
 * stamp, so it cannot be allowed to win an edit. Anything genuinely later
 * arrives the way it always has, through the other device's log.
 */

export interface AdoptionResult {
  /** Songs created here from the snapshot. */
  readonly songs: number
  readonly tags: number
  readonly playlists: number
  /**
   * Songs in the snapshot the bucket has no audio for. Their rows are made, so
   * the tags and plays and playlist places survive, but nothing points at a
   * file nobody can download, so they are not published.
   */
  readonly withoutAudio: number
}

const NOTHING: AdoptionResult = { songs: 0, tags: 0, playlists: 0, withoutAudio: 0 }

/**
 * What `cloud_songs` says about a song nobody on this device has read.
 *
 * The signatures are what the upload pass compares a file's size, cover
 * revision and lyric sidecar against to decide whether to send it again. Two of
 * them are set to the value a song with no local file of that kind really
 * produces (`none`), which is the point: if the audio later lands here and the
 * cover and the curve do not, they are still the bucket's, and the snapshot
 * goes on naming them rather than quietly dropping them from every device.
 * Audio and lyrics have no such value, so they get one no real file can make
 * and are worked out properly the moment there is a file to work them out from.
 */
const ADOPTED_SIGNATURE = 'adopted'
const NO_LOCAL_FILE = 'none'

interface Prepared {
  readonly song: CloudSong
  readonly path: string
  /** Whether the bucket really holds this song's audio. */
  readonly audioPresent: boolean
}

export class CloudAdopt {
  readonly #db: Db
  readonly #songs: SongRepository
  readonly #tags: TagRepository
  readonly #playlists: PlaylistRepository
  readonly #features: AudioFeaturesRepository
  readonly #cloud: CloudRepository
  readonly #sync: SyncRepository
  readonly #storage: StorageDriver
  readonly #clock: SyncClock
  readonly #logger: Logger

  constructor(deps: {
    db: Db
    songs: SongRepository
    tags: TagRepository
    playlists: PlaylistRepository
    features: AudioFeaturesRepository
    cloud: CloudRepository
    sync: SyncRepository
    storage: StorageDriver
    clock: SyncClock
    logger: Logger
  }) {
    this.#db = deps.db
    this.#songs = deps.songs
    this.#tags = deps.tags
    this.#playlists = deps.playlists
    this.#features = deps.features
    this.#cloud = deps.cloud
    this.#sync = deps.sync
    this.#storage = deps.storage
    this.#clock = deps.clock
    this.#logger = deps.logger.child('adopt')
  }

  /**
   * Take on everything in this snapshot that is not here yet.
   *
   * Run twice over the same snapshot it does nothing the second time: every
   * match is by uid, and a uid that is already a row here is skipped. A server
   * holding ten of the bucket's fifty-two ends with fifty-two, not sixty-two.
   *
   * Picking where each song's file will go touches the disk, which the database
   * transaction cannot, so it happens first, for every song at once. The
   * writing is then one transaction: either this server has the bucket's
   * library or it has what it had before, never half of each — a half-adopted
   * library that published would be the original bug wearing a hat.
   */
  async adopt(snapshot: CloudSnapshot): Promise<AdoptionResult> {
    const prepared = await this.#prepare(snapshot.songs)
    const newPlaylists = snapshot.playlists.filter(list => !this.#sync.playlist(list.uid))
    const newTags = snapshot.tags.filter(tag => !this.#sync.tag(tag.uid))
    if (prepared.length === 0 && newPlaylists.length === 0 && newTags.length === 0) return NOTHING

    return this.#db.transaction((): AdoptionResult => {
      const tags = this.#adoptTags(snapshot)
      for (const item of prepared) this.#adoptSong(item)
      const playlists = this.#adoptPlaylists(newPlaylists)
      return {
        songs: prepared.length,
        tags,
        playlists,
        withoutAudio: prepared.filter(item => !item.audioPresent).length,
      }
    })()
  }

  /**
   * Where each song this server has never seen would live on disk, worked out
   * before anything is written.
   *
   * `songs.path` is `NOT NULL UNIQUE` and the library folder is watched, so the
   * name has to be free in both places: a row pointed at a file that is already
   * some other song's would have the next scan hand that file to this song.
   * `taken` keeps two songs of the same name in one snapshot apart, since
   * neither is on disk or in the database yet for the other to find.
   */
  async #prepare(songs: readonly CloudSong[]): Promise<Prepared[]> {
    const prepared: Prepared[] = []
    const taken = new Set<string>()
    for (const song of songs) {
      if (this.#sync.songId(song.uid) !== null) continue
      const key = await this.#freeKey(song, taken)
      if (!key) {
        this.#logger.warn('no free name in the library for a song from the bucket', {
          uid: song.uid,
          title: song.title,
        })
        continue
      }
      prepared.push({ song, path: key, audioPresent: this.#cloud.hasFile(song.audio.key) })
    }
    return prepared
  }

  async #freeKey(song: CloudSong, taken: Set<string>): Promise<string | null> {
    const label = song.artist.trim() ? `${song.artist} - ${song.title}` : song.title
    const name = sanitizeFilename(label) || 'untitled'
    const extension = path.posix.extname(song.audio.key) || '.m4a'
    for (const candidate of songKeyCandidates(name, extension)) {
      const folder = path.posix.dirname(candidate)
      if (taken.has(folder)) continue
      if (this.#songs.byPath(candidate)) continue
      if (!(await isFreeOnDisk(this.#storage, candidate))) continue
      taken.add(folder)
      return candidate
    }
    return null
  }

  /**
   * The bucket's tags, and the second uids for tags two devices made under one
   * name. Exactly what `tagCreated` does when it arrives in a log: a name this
   * server already uses is one tag, and the snapshot's uid is kept as a way of
   * finding it, so a late change that names it still lands.
   */
  #adoptTags(snapshot: CloudSnapshot): number {
    let made = 0
    for (const tag of snapshot.tags) {
      if (this.#sync.tag(tag.uid)) continue
      const same = this.#sync.tagNamed(tag.name)
      if (same) {
        this.#sync.addAlias(tag.uid, same.id)
        continue
      }
      this.#tags.insertSynced(tag.uid, tag.name, tag.hue)
      this.#stamp('tag', tag.uid, tag.stamps)
      made++
    }
    // Aliases the snapshot itself carries, now that both sides of each exist.
    for (const [uid, target] of Object.entries(snapshot.aliases ?? {})) {
      if (this.#sync.tag(uid)) continue
      const tag = this.#sync.tag(target)
      if (tag) this.#sync.addAlias(uid, tag.id)
    }
    return made
  }

  #adoptSong({ song, path: key, audioPresent }: Prepared): void {
    const id = this.#songs.insertAdopted({
      uid: song.uid,
      path: key,
      title: song.title,
      artist: song.artist,
      album: song.album,
      albumArtist: song.albumArtist,
      trackNo: song.trackNo,
      year: song.year,
      duration: song.duration,
      sizeBytes: song.audio.size,
      mime: song.audio.mime,
      lyricsKind: song.lyrics?.kind ?? 'none',
      instrumental: song.instrumental,
      loved: song.loved,
      playCount: song.playCount,
      skipCount: song.skipCount,
      lastPlayedAt: song.lastPlayedAt,
      addedAt: song.addedAt,
      sourceUrl: song.sourceUrl,
    })

    for (const tagUid of song.tagUids) {
      const tag = this.#sync.tag(tagUid)
      if (tag) this.#tags.addToSong(id, tag.id)
    }

    if (song.audioFeatures) {
      const { analyzedAt, ...rest } = song.audioFeatures
      this.#features.insertSynced(id, { ...rest, analyzedAt })
    }

    // The colour was read from the cover in the bucket, which is the cover this
    // song has. `art_rev` is 0 on a row nobody has written a cover for, and
    // that is the revision the colour is recorded against.
    if (song.coverTone) this.#songs.setCoverTone(id, 0, song.coverTone)

    this.#stamp('song', song.uid, song.stamps)
    this.#stamp('songTag', song.uid, song.tagStamps)

    // Without the audio there is nothing to point at. The row stays — the tags,
    // the plays and the playlist places are worth keeping whatever happened to
    // the file — but it is left out of what this server publishes, exactly as
    // `reconcileFiles` leaves out a song whose file the bucket has lost.
    if (!audioPresent) return

    this.#cloud.saveState({
      songId: id,
      audioKey: song.audio.key,
      audioSize: song.audio.size,
      audioSig: ADOPTED_SIGNATURE,
      coverKey: song.cover?.key ?? null,
      coverSize: song.cover?.size ?? null,
      coverSig: NO_LOCAL_FILE,
      lyricsKey: song.lyrics?.key ?? null,
      lyricsSize: song.lyrics?.size ?? null,
      lyricsKind: song.lyrics?.kind ?? null,
      romanizedKey: song.lyrics?.romanized ?? null,
      lyricsSig: ADOPTED_SIGNATURE,
      motionKey: song.motion ?? null,
      motionSig: NO_LOCAL_FILE,
    })
    // So the next pass does not ask the bucket whether it has files it just
    // told us about.
    this.#cloud.recordFile(song.audio.key, song.audio.size)
    if (song.cover) this.#cloud.recordFile(song.cover.key, song.cover.size)
    if (song.lyrics) this.#cloud.recordFile(song.lyrics.key, song.lyrics.size)
  }

  #adoptPlaylists(playlists: readonly CloudPlaylist[]): number {
    let made = 0
    for (const list of playlists) {
      const id = this.#playlists.insertSynced({
        uid: list.uid,
        name: list.name,
        description: list.description,
        kind: list.kind,
        rules: list.rules
          ? fromCloudRules(list.rules, uid => this.#sync.tag(uid)?.id ?? null)
          : null,
        pinned: list.pinned,
        createdAt: list.createdAt,
      })
      // A live playlist works its own songs out from its rules; the uids in the
      // snapshot are what it matched where it was written, and are not its
      // membership to be copied.
      if (list.kind === 'manual') {
        const songIds = list.songUids.flatMap(uid => {
          const songId = this.#sync.songId(uid)
          return songId === null ? [] : [songId]
        })
        if (songIds.length > 0) this.#playlists.add(id, songIds)
      }
      // `add` dates a playlist "now"; it was last changed when the snapshot says.
      this.#playlists.setUpdatedAt(id, list.updatedAt)
      this.#stamp('playlist', list.uid, list.stamps)
      this.#stamp('playlistSong', list.uid, list.songStamps)
      made++
    }
    return made
  }

  /**
   * The stamps a thing arrived with, kept as its own.
   *
   * Only for things adopted here. Keeping a stamp without the value it belongs
   * to would make a change that carries that value lose to a field this server
   * never actually took — which is how you lose an edit for good.
   *
   * The clock is moved past each one for the same reason every ingested change
   * moves it: an edit made here next has to come after everything this server
   * has seen, or it loses to a stamp already in its own database.
   */
  #stamp(
    kind: 'song' | 'songTag' | 'tag' | 'playlist' | 'playlistSong',
    uid: string,
    stamps: Readonly<Record<string, string>> | undefined,
  ): void {
    for (const [field, hlc] of Object.entries(stamps ?? {})) {
      this.#sync.setStamp(kind, uid, field, hlc)
      this.#clock.observe(hlc)
    }
  }
}
