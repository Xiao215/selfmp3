import { hlcWins, MERGE_GAP_FIELDS } from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import type { SyncRepository } from '../repositories/sync.js'

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

/** The song's columns the fold reads, by the names the shared rule uses. */
interface Row {
  readonly id: number
  readonly uid: string
  readonly artist: string
  readonly album: string
  readonly albumArtist: string
  readonly year: number | null
  readonly trackNo: number | null
  readonly loved: number
  readonly hasArt: number
  readonly artExt: string | null
  readonly artRev: number
  readonly coverHue: number | null
  readonly coverChroma: number | null
  readonly coverPalette: string | null
  readonly coverToneRev: number | null
  readonly sourceUrl: string | null
  readonly playCount: number
  readonly lastPlayedAt: string | null
}

interface CloudRow {
  readonly cover_key: string | null
  readonly cover_size: number | null
  readonly lyrics_key: string | null
  readonly lyrics_size: number | null
  readonly lyrics_kind: string | null
  readonly lyrics_sig: string
}

const COLUMN: Record<(typeof MERGE_GAP_FIELDS)[number], string> = {
  artist: 'artist',
  album: 'album',
  albumArtist: 'album_artist',
  year: 'year',
  trackNo: 'track_no',
}

const blank = (value: unknown): boolean => value === null || value === ''

export class SongMerge {
  readonly #db: Db
  readonly #sync: SyncRepository
  readonly #copyCover: (fromId: number, intoId: number) => void

  constructor(deps: {
    db: Db
    sync: SyncRepository
    /** Copies the copy's cover file here to the song kept (`CoverService.copy`). */
    copyCover?: (fromId: number, intoId: number) => void
  }) {
    this.#db = deps.db
    this.#sync = deps.sync
    this.#copyCover = deps.copyCover ?? (() => undefined)
  }

  /** Folds `extraId` into `keptId`. False, with nothing done, when either is gone or they are one. */
  merge(extraId: number, keptId: number, hlc: string): boolean {
    if (extraId === keptId) return false
    const extra = this.#row(extraId)
    const kept = this.#row(keptId)
    if (!extra || !kept) return false
    const db = this.#db

    // Tags: the copy's, each unless the kept song's own was changed later.
    const keptTags = new Set(this.#tagUids(keptId).map(tag => tag.uid))
    for (const tag of this.#tagUids(extraId)) {
      if (keptTags.has(tag.uid)) continue
      if (!hlcWins(hlc, this.#sync.stamp('songTag', kept.uid, tag.uid))) continue
      db.prepare('INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?, ?)').run(
        keptId,
        tag.id,
      )
      this.#sync.setStamp('songTag', kept.uid, tag.uid, hlc)
    }

    // Loved, and the names and numbers the kept song has none of.
    const patch: Record<string, unknown> = {}
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

    // The cover and the words, as the bucket has them, where the kept song has none.
    const keptCloud = this.#cloud(keptId)
    const extraCloud = this.#cloud(extraId)
    if (keptCloud && extraCloud) {
      if (keptCloud.cover_key === null && extraCloud.cover_key !== null) {
        const rev = kept.artRev + 1
        db.prepare(
          'UPDATE cloud_songs SET cover_key = ?, cover_size = ?, cover_sig = ? WHERE song_id = ?',
        ).run(extraCloud.cover_key, extraCloud.cover_size, `art-${rev}`, keptId)
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
      if (keptCloud.lyrics_key === null && extraCloud.lyrics_key !== null) {
        db.prepare(
          `UPDATE cloud_songs SET lyrics_key = ?, lyrics_size = ?, lyrics_kind = ?,
                  lyrics_sig = ? WHERE song_id = ?`,
        ).run(
          extraCloud.lyrics_key,
          extraCloud.lyrics_size,
          extraCloud.lyrics_kind,
          extraCloud.lyrics_sig,
          keptId,
        )
        patch['lyrics_kind'] = extraCloud.lyrics_kind ?? 'plain'
      }
    }

    // Every play, so the history and the counts are the kept song's.
    db.prepare('UPDATE play_events SET song_id = ? WHERE song_id = ?').run(keptId, extraId)
    patch['play_count'] = kept.playCount + extra.playCount
    if (kept.lastPlayedAt === null || (extra.lastPlayedAt ?? '') > kept.lastPlayedAt) {
      patch['last_played_at'] = extra.lastPlayedAt
    }
    const columns = Object.keys(patch)
    db.prepare(
      `UPDATE songs SET ${columns.map(column => `${column} = @${column}`).join(', ')},
              updated_at = datetime('now') WHERE id = @id`,
    ).run({ ...patch, id: keptId })

    // Its places in playlists: the kept song takes each, unless it is there already.
    const places = db
      .prepare<[number], { playlist_id: number; uid: string }>(
        `SELECT i.playlist_id, p.uid FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id
          WHERE i.song_id = ?`,
      )
      .all(extraId)
    for (const place of places) {
      const has = db
        .prepare<[number, number], { n: number }>(
          'SELECT 1 AS n FROM playlist_items WHERE playlist_id = ? AND song_id = ?',
        )
        .get(place.playlist_id, keptId)
      if (has) {
        db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND song_id = ?').run(
          place.playlist_id,
          extraId,
        )
        continue
      }
      db.prepare('UPDATE playlist_items SET song_id = ? WHERE playlist_id = ? AND song_id = ?').run(
        keptId,
        place.playlist_id,
        extraId,
      )
      const stamp = this.#sync.stamp('playlistSong', place.uid, extra.uid)
      if (stamp !== null && hlcWins(stamp, this.#sync.stamp('playlistSong', place.uid, kept.uid))) {
        this.#sync.setStamp('playlistSong', place.uid, kept.uid, stamp)
      }
    }

    this.#sync.addMerge(extra.uid, extraId, keptId)
    return true
  }

  #row(id: number): Row | null {
    return (
      this.#db
        .prepare<[number], Row>(
          `SELECT id, uid, artist, album, album_artist AS albumArtist, year, track_no AS trackNo,
                  loved, has_art AS hasArt, art_ext AS artExt, art_rev AS artRev,
                  cover_hue AS coverHue, cover_chroma AS coverChroma, cover_palette AS coverPalette,
                  cover_tone_rev AS coverToneRev, source_url AS sourceUrl,
                  play_count AS playCount, last_played_at AS lastPlayedAt
             FROM songs WHERE id = ?`,
        )
        .get(id) ?? null
    )
  }

  #tagUids(songId: number): { id: number; uid: string }[] {
    return this.#db
      .prepare<[number], { id: number; uid: string }>(
        'SELECT t.id, t.uid FROM song_tags st JOIN tags t ON t.id = st.tag_id WHERE st.song_id = ?',
      )
      .all(songId)
  }

  #cloud(songId: number): CloudRow | null {
    return (
      this.#db
        .prepare<[number], CloudRow>(
          `SELECT cover_key, cover_size, lyrics_key, lyrics_size, lyrics_kind, lyrics_sig
             FROM cloud_songs WHERE song_id = ?`,
        )
        .get(songId) ?? null
    )
  }
}
