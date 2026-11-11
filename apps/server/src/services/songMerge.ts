import { hlcWins, MERGE_GAP_FIELDS } from '@selfmp3/shared'
import type { CloudRepository } from '../repositories/cloud.js'
import type { PlaylistRepository } from '../repositories/playlists.js'
import type { MergedColumn, SongRepository } from '../repositories/songs.js'
import type { StatsRepository } from '../repositories/stats.js'
import type { SyncRepository } from '../repositories/sync.js'
import type { TagRepository } from '../repositories/tags.js'

/**
 * A song held twice, folded into the copy kept (`songMerged`, docs/SYNC.md),
 * in this server's database: the rule every device replays (`mergedSong` in
 * packages/shared/src/sync.ts), followed against SQLite, and held to the same
 * library by cloudIngest.test.ts.
 *
 * Besides the shared rule, the server moves what only it keeps: every play the
 * copy had, so Stats and the bucket's plays files count them under the song
 * kept (the month's signature moves with them, `StatsRepository.months`); and
 * the copy's cover file here, where the kept song had none.
 *
 * It leaves the copy itself for the caller to remove, the way a removal is
 * made there — another device's, or one asked of this server.
 */

const COLUMN: Record<(typeof MERGE_GAP_FIELDS)[number], MergedColumn> = {
  artist: 'artist',
  album: 'album',
  albumArtist: 'album_artist',
  year: 'year',
  trackNo: 'track_no',
}

const blank = (value: unknown): boolean => value === null || value === ''

export class SongMerge {
  readonly #songs: SongRepository
  readonly #tags: TagRepository
  readonly #playlists: PlaylistRepository
  readonly #stats: StatsRepository
  readonly #cloud: CloudRepository
  readonly #sync: SyncRepository
  readonly #copyCover: (fromId: number, intoId: number) => void

  constructor(deps: {
    songs: SongRepository
    tags: TagRepository
    playlists: PlaylistRepository
    stats: StatsRepository
    cloud: CloudRepository
    sync: SyncRepository
    /** Copies the copy's cover file here to the song kept (`CoverService.copy`). */
    copyCover?: (fromId: number, intoId: number) => void
  }) {
    this.#songs = deps.songs
    this.#tags = deps.tags
    this.#playlists = deps.playlists
    this.#stats = deps.stats
    this.#cloud = deps.cloud
    this.#sync = deps.sync
    this.#copyCover = deps.copyCover ?? (() => undefined)
  }

  /** Folds `extraId` into `keptId`. False, with nothing done, when either is gone or they are one. */
  merge(extraId: number, keptId: number, hlc: string): boolean {
    if (extraId === keptId) return false
    const extra = this.#songs.mergeRow(extraId)
    const kept = this.#songs.mergeRow(keptId)
    if (!extra || !kept) return false

    // Tags: the copy's, each unless the kept song's own was changed later.
    const keptTags = new Set(this.#tags.ofSong(keptId).map(tag => tag.uid))
    for (const tag of this.#tags.ofSong(extraId)) {
      if (keptTags.has(tag.uid)) continue
      if (!hlcWins(hlc, this.#sync.stamp('songTag', kept.uid, tag.uid))) continue
      this.#tags.addToSong(keptId, tag.id)
      this.#sync.setStamp('songTag', kept.uid, tag.uid, hlc)
    }

    // Loved, and the names and numbers the kept song has none of.
    const patch: Partial<Record<MergedColumn, unknown>> = {}
    if (extra.loved && !kept.loved && hlcWins(hlc, this.#sync.stamp('song', kept.uid, 'loved'))) {
      patch['loved'] = 1
      this.#sync.setStamp('song', kept.uid, 'loved', hlc)
    }
    for (const field of MERGE_GAP_FIELDS) {
      if (!blank(kept[field]) || blank(extra[field])) continue
      if (!hlcWins(hlc, this.#sync.stamp('song', kept.uid, field))) continue
      patch[COLUMN[field]] = extra[field]
      this.#sync.setStamp('song', kept.uid, field, hlc)
    }
    if (kept.sourceUrl === null && extra.sourceUrl !== null) patch['source_url'] = extra.sourceUrl
    if (kept.cameWith === null && extra.cameWith !== null) patch['came_with'] = extra.cameWith

    // The cover and the words, as the bucket has them, where the kept song has none.
    const keptCloud = this.#cloud.state(keptId)
    const extraCloud = this.#cloud.state(extraId)
    if (keptCloud && extraCloud) {
      if (keptCloud.coverKey === null && extraCloud.coverKey !== null) {
        const rev = kept.artRev + 1
        this.#cloud.takeCover(keptId, extraCloud.coverKey, extraCloud.coverSize, `art-${rev}`)
        Object.assign(patch, {
          has_art: 1,
          art_ext: extra.artExt,
          art_rev: rev,
          cover_hue: extra.coverHue,
          cover_chroma: extra.coverChroma,
          cover_palette: extra.coverPalette,
          // Read from the same picture: still the cover's colour.
          cover_tone_rev: extra.coverToneRev === extra.artRev ? rev : null,
        })
        if (extra.hasArt) this.#copyCover(extraId, keptId)
      }
      if (keptCloud.lyricsKey === null && extraCloud.lyricsKey !== null) {
        this.#cloud.takeLyrics(keptId, extraCloud)
        patch['lyrics_kind'] = extraCloud.lyricsKind ?? 'plain'
      }
    }

    // Every play, so the history and the counts are the kept song's.
    this.#stats.movePlays(extraId, keptId)
    patch['play_count'] = kept.playCount + extra.playCount
    if (kept.lastPlayedAt === null || (extra.lastPlayedAt ?? '') > kept.lastPlayedAt) {
      patch['last_played_at'] = extra.lastPlayedAt
    }
    this.#songs.setMerged(keptId, patch)

    // Its places in playlists: the kept song takes each, unless it is there already.
    for (const playlistUid of this.#playlists.givePlaces(extraId, keptId)) {
      const stamp = this.#sync.stamp('playlistSong', playlistUid, extra.uid)
      if (
        stamp !== null &&
        hlcWins(stamp, this.#sync.stamp('playlistSong', playlistUid, kept.uid))
      ) {
        this.#sync.setStamp('playlistSong', playlistUid, kept.uid, stamp)
      }
    }

    this.#sync.addMerge(extra.uid, extraId, keptId)
    return true
  }
}
