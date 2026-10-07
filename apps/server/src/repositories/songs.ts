import type { CoverTone, Song, SongPatch } from '@selfmp3/shared'
import type Database from 'better-sqlite3'
import type { Db } from '../db/index.js'
import { toSong, type SongRow } from '../db/rows.js'
import { fileEtag } from '../storage/driver.js'

/**
 * All SQL that touches the `songs` table lives here.
 *
 * Statements are prepared once in the constructor rather than on every call.
 * better-sqlite3 caches the compiled plan, which turns a full library read
 * from thousands of parses into one.
 */

/**
 * Columns plus the aggregated tag list and the analysed features, used
 * everywhere a Song is returned. The features join is a LEFT JOIN so a song
 * that has not been analysed yet is still a song.
 */
const SONG_SELECT = `
  SELECT s.*,
         (SELECT GROUP_CONCAT(tag_id) FROM song_tags WHERE song_id = s.id) AS tag_ids,
         f.bpm           AS feat_bpm,
         f.energy        AS feat_energy,
         f.loudness_lufs AS feat_loudness_lufs,
         f.key           AS feat_key,
         f.camelot       AS feat_camelot,
         f.danceability  AS feat_danceability,
         f.analyzed_at   AS feat_analyzed_at,
         f.version       AS feat_version
  FROM songs s
  LEFT JOIN song_audio_features f ON f.song_id = s.id
`

/** A song taken from the bucket's snapshot: its audio is in the bucket, not here. */
interface AdoptedSong {
  uid: string
  path: string
  title: string
  artist: string
  album: string
  albumArtist: string
  trackNo: number | null
  year: number | null
  duration: number
  /** The size of the audio in the bucket, so the library can total its bytes. */
  sizeBytes: number
  mime: string
  lyricsKind: string
  instrumental: boolean
  loved: boolean
  playCount: number
  skipCount: number
  lastPlayedAt: string | null
  addedAt: string
  sourceUrl: string | null
}

interface NewSong {
  path: string
  title: string
  artist: string
  album: string
  albumArtist: string
  trackNo: number | null
  year: number | null
  duration: number
  sizeBytes: number
  mime: string
  mtimeMs: number
  hasArt: boolean
  artExt: string | null
  lyricsKind: string
  sourceUrl: string | null
}

export class SongRepository {
  readonly #db: Db

  readonly #all
  readonly #byId
  readonly #byPath
  readonly #insert
  readonly #insertAdopted
  readonly #updateScanned
  readonly #withSource
  readonly #setSourceUrl
  readonly #deleteById
  readonly #recordPlay
  readonly #recordSkip
  readonly #setArt
  readonly #artExt
  readonly #setLyricsKind
  readonly #setInstrumental
  readonly #count
  readonly #manifest
  readonly #setLoved
  readonly #withoutArt
  readonly #nextYearToCheck
  readonly #yearChecked
  readonly #nextWithoutCoverTone
  readonly #setCoverTone
  readonly #allPaths
  /** `patch` statements by the columns they set: a handful of shapes, each prepared once. */
  readonly #patches = new Map<string, Database.Statement>()

  constructor(db: Db) {
    this.#db = db

    this.#all = db.prepare<[], SongRow>(`${SONG_SELECT} ORDER BY s.added_at DESC, s.id DESC`)
    this.#byId = db.prepare<[number], SongRow>(`${SONG_SELECT} WHERE s.id = ?`)
    this.#byPath = db.prepare<[string], SongRow>(`${SONG_SELECT} WHERE s.path = ?`)

    this.#insert = db.prepare(`
      INSERT INTO songs (
        path, title, artist, album, album_artist, track_no, year,
        duration, size_bytes, mime, mtime_ms, has_art, art_ext, lyrics_kind, source_url
      ) VALUES (
        @path, @title, @artist, @album, @albumArtist, @trackNo, @year,
        @duration, @sizeBytes, @mime, @mtimeMs, @hasArt, @artExt, @lyricsKind, @sourceUrl
      )
    `)

    // `mtime_ms` is 0: no file of this song has ever been on this disk, and
    // the upload pass reads the audio's signature as its size and that.
    this.#insertAdopted = db.prepare(`
      INSERT INTO songs (
        uid, path, title, artist, album, album_artist, track_no, year, duration,
        size_bytes, mime, mtime_ms, has_art, art_ext, lyrics_kind, instrumental,
        play_count, skip_count, loved, source_url, last_played_at, added_at
      ) VALUES (
        @uid, @path, @title, @artist, @album, @albumArtist, @trackNo, @year, @duration,
        @sizeBytes, @mime, 0, 0, NULL, @lyricsKind, @instrumental,
        @playCount, @skipCount, @loved, @sourceUrl, @lastPlayedAt, @addedAt
      )
    `)

    // Refresh only the fields derived from the file itself. User edits to
    // title/artist/album survive a rescan, which is the whole point of keeping
    // metadata in the database rather than rewriting tags into the audio file.
    this.#updateScanned = db.prepare(`
      UPDATE songs
         SET duration    = @duration,
             size_bytes  = @sizeBytes,
             mime        = @mime,
             mtime_ms    = @mtimeMs,
             lyrics_kind = @lyricsKind,
             updated_at  = datetime('now')
       WHERE id = @id
    `)

    this.#setSourceUrl = db.prepare('UPDATE songs SET source_url = ? WHERE id = ?')
    this.#withSource = db.prepare<[], { id: number; source_url: string }>(
      'SELECT id, source_url FROM songs WHERE source_url IS NOT NULL',
    )
    this.#deleteById = db.prepare('DELETE FROM songs WHERE id = ?')

    // `last_played_at` only moves forward: a play from last Tuesday, sent
    // today by a phone that was offline, must not overwrite one from an hour
    // ago. Both sides are SQLite's own UTC format, so they compare as text.
    this.#recordPlay = db.prepare(`
      UPDATE songs
         SET play_count     = play_count + 1,
             last_played_at = CASE
               WHEN last_played_at IS NULL
                 OR last_played_at < COALESCE(@at, datetime('now'))
               THEN COALESCE(@at, datetime('now'))
               ELSE last_played_at
             END,
             updated_at     = datetime('now')
       WHERE id = @id
    `)

    this.#recordSkip = db.prepare('UPDATE songs SET skip_count = skip_count + 1 WHERE id = ?')

    this.#setArt = db.prepare(
      'UPDATE songs SET has_art = ?, art_ext = ?, art_rev = art_rev + 1 WHERE id = ?',
    )
    this.#artExt = db.prepare<[number], { art_ext: string | null }>(
      'SELECT art_ext FROM songs WHERE id = ?',
    )
    this.#setLyricsKind = db.prepare('UPDATE songs SET lyrics_kind = ? WHERE id = ?')
    this.#setInstrumental = db.prepare('UPDATE songs SET instrumental = ? WHERE id = ?')

    this.#count = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM songs')
    this.#manifest = db.prepare<[], { id: number; size_bytes: number; mtime_ms: number }>(
      'SELECT id, size_bytes, mtime_ms FROM songs ORDER BY id',
    )
    this.#setLoved = db.prepare(
      "UPDATE songs SET loved = ?, updated_at = datetime('now') WHERE id = ? AND loved != ?",
    )
    this.#withoutArt = db.prepare<[], SongRow>(`${SONG_SELECT} WHERE s.has_art = 0 ORDER BY s.id`)
    this.#nextYearToCheck = db.prepare<
      [number],
      { id: number; year: number | null; source_url: string | null; edited: number }
    >(
      `SELECT s.id, s.year, s.source_url,
              EXISTS (SELECT 1 FROM sync_stamps t
                       WHERE t.kind = 'song' AND t.uid = s.uid AND t.field = 'year') AS edited
         FROM release_years_to_check c
         JOIN songs s ON s.id = c.song_id
        WHERE c.song_id > ?
        ORDER BY c.song_id LIMIT 1`,
    )
    this.#yearChecked = db.prepare('DELETE FROM release_years_to_check WHERE song_id = ?')
    this.#nextWithoutCoverTone = db.prepare<[], { id: number; art_rev: number }>(
      `SELECT id, art_rev FROM songs
        WHERE has_art = 1
          AND (cover_tone_rev IS NULL OR cover_tone_rev != art_rev)
        ORDER BY id LIMIT 1`,
    )
    this.#setCoverTone = db.prepare(
      'UPDATE songs SET cover_hue = ?, cover_chroma = ?, cover_palette = ?, cover_tone_rev = ? WHERE id = ? AND art_rev = ?',
    )
    this.#allPaths = db.prepare<[], { id: number; path: string; mtime_ms: number }>(
      'SELECT id, path, mtime_ms FROM songs',
    )
  }

  all(): Song[] {
    return this.#all.all().map(toSong)
  }

  /**
   * The songs downloaded from these links, by the id in the link rather than
   * the link itself: the same video reaches us as `youtube.com/watch?v=…`,
   * `music.youtube.com/watch?v=…` and `youtu.be/…`, and a download from one
   * must be recognised when the next paste uses another.
   *
   * Only rows that came from a link are looked at — most of a scanned library
   * has no source at all — which is what the partial index is for.
   */
  withSourceUrls(): { id: number; sourceUrl: string }[] {
    return this.#withSource.all().map(row => ({ id: row.id, sourceUrl: row.source_url }))
  }

  byId(id: number): Song | null {
    const row = this.#byId.get(id)
    return row ? toSong(row) : null
  }

  byPath(path: string): Song | null {
    const row = this.#byPath.get(path)
    return row ? toSong(row) : null
  }

  /** Returns the new row id. */
  insert(song: NewSong): number {
    const info = this.#insert.run({
      ...song,
      hasArt: song.hasArt ? 1 : 0,
    })
    return Number(info.lastInsertRowid)
  }

  /**
   * A song this server learned about from the bucket rather than from a file
   * (services/cloudAdopt.ts): everything the library knows about it.
   *
   * It still needs a `path`, which is `NOT NULL UNIQUE` — that column is where
   * a copy of the file goes should one ever land here. `has_art` stays 0: the
   * cover is in the bucket, not here, and `cloud_songs` is what keeps pointing
   * at it.
   */
  insertAdopted(song: AdoptedSong): number {
    const info = this.#insertAdopted.run({
      ...song,
      loved: song.loved ? 1 : 0,
      instrumental: song.instrumental ? 1 : 0,
    })
    return Number(info.lastInsertRowid)
  }

  updateScanned(input: {
    id: number
    duration: number
    sizeBytes: number
    mime: string
    mtimeMs: number
    lyricsKind: string
  }): void {
    this.#updateScanned.run(input)
  }

  /**
   * Apply a user's manual edits.
   *
   * The column list is a fixed allow-list rather than anything derived from
   * the request body, so no amount of creative JSON can reach a column the
   * user is not meant to write.
   */
  patch(id: number, patch: SongPatch): void {
    const assignments: string[] = []
    const values: Record<string, unknown> = { id }

    const columns: Record<keyof SongPatch, string> = {
      title: 'title',
      artist: 'artist',
      album: 'album',
      albumArtist: 'album_artist',
      year: 'year',
      trackNo: 'track_no',
      loved: 'loved',
      instrumental: 'instrumental',
    }

    for (const [key, column] of Object.entries(columns) as [keyof SongPatch, string][]) {
      const value = patch[key]
      if (value === undefined) continue
      assignments.push(`${column} = @${key}`)
      values[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value
    }

    if (assignments.length === 0) return
    const set = assignments.join(', ')
    let statement = this.#patches.get(set)
    if (!statement) {
      statement = this.#db.prepare(
        `UPDATE songs SET ${set}, updated_at = datetime('now') WHERE id = @id`,
      )
      this.#patches.set(set, statement)
    }
    statement.run(values)
  }

  /** Where an imported song came from: how its own lyrics are found later. */
  setSourceUrl(id: number, url: string): void {
    this.#setSourceUrl.run(url, id)
  }

  delete(id: number): void {
    this.#deleteById.run(id)
  }

  /**
   * Look several songs up at once, in the order they were asked for.
   *
   * One `IN (...)` beats N round trips through `byId`, and returning only the
   * ones that exist lets a caller work out which ids were stale without a
   * second query.
   */
  byIds(ids: readonly number[]): Song[] {
    if (ids.length === 0) return []
    const unique = [...new Set(ids)]
    const placeholders = unique.map(() => '?').join(',')
    const rows = this.#db
      .prepare<number[], SongRow>(`${SONG_SELECT} WHERE s.id IN (${placeholders})`)
      .all(...unique)
    const byId = new Map(rows.map(row => [row.id, toSong(row)]))
    return unique.map(id => byId.get(id)).filter(song => song !== undefined)
  }

  /** Which of these ids are songs here: one query, for checking a batch from a device. */
  existingIds(ids: readonly number[]): Set<number> {
    const found = new Set<number>()
    const unique = [...new Set(ids)]
    // In slices, well under SQLite's limit on bound parameters.
    for (let start = 0; start < unique.length; start += 500) {
      const slice = unique.slice(start, start + 500)
      const rows = this.#db
        .prepare<number[], { id: number }>(
          `SELECT id FROM songs WHERE id IN (${slice.map(() => '?').join(',')})`,
        )
        .all(...slice)
      for (const row of rows) found.add(row.id)
    }
    return found
  }

  /**
   * Remove many songs in one transaction.
   *
   * All or nothing: a batch that half-applied would leave the library in a
   * state nobody asked for and no undo to reach it from. Ids that are not in
   * the database are reported rather than thrown — a phone working from a
   * stale library should lose the rows it can and be told about the rest,
   * not have the whole request fail.
   */
  deleteMany(ids: readonly number[]): { removed: number[]; missing: number[] } {
    if (ids.length === 0) return { removed: [], missing: [] }

    const run = this.#db.transaction((unique: readonly number[]) => {
      const removed: number[] = []
      const missing: number[] = []
      for (const id of unique) {
        if (this.#deleteById.run(id).changes > 0) removed.push(id)
        else missing.push(id)
      }
      return { removed, missing }
    })

    return run([...new Set(ids)])
  }

  /** Love or unlove many songs at once. Returns how many rows changed. */
  setLovedMany(ids: readonly number[], loved: boolean): number {
    if (ids.length === 0) return 0

    const value = loved ? 1 : 0

    const run = this.#db.transaction((unique: readonly number[]) => {
      let affected = 0
      for (const id of unique) affected += this.#setLoved.run(value, id, value).changes
      return affected
    })

    return run([...new Set(ids)])
  }

  /** `playedAt` in SQLite's UTC format, or null for now (see `sqliteTime`). */
  recordPlay(id: number, playedAt: string | null = null): void {
    this.#recordPlay.run({ id, at: playedAt })
  }

  recordSkip(id: number): void {
    this.#recordSkip.run(id)
  }

  setArt(id: number, hasArt: boolean, extension: string | null): void {
    this.#setArt.run(hasArt ? 1 : 0, extension, id)
  }

  /** The extension the song's kept cover was saved with (`setArt`), or null. */
  artExt(id: number): string | null {
    return this.#artExt.get(id)?.art_ext ?? null
  }

  setLyricsKind(id: number, kind: string): void {
    this.#setLyricsKind.run(kind, id)
  }

  /** Remember (or forget) that a song has no words, so lyrics are not looked up. */
  setInstrumental(id: number, on: boolean): void {
    this.#setInstrumental.run(on ? 1 : 0, id)
  }

  count(): number {
    return this.#count.get()?.n ?? 0
  }

  /** Compact list used by the phone to work out what it still needs to cache. */
  manifest(): Array<{ id: number; sizeBytes: number; etag: string }> {
    return this.#manifest.all().map(row => ({
      id: row.id,
      sizeBytes: row.size_bytes,
      etag: fileEtag(row.size_bytes, row.mtime_ms),
    }))
  }

  /** Songs with no cover art, for the cover-art pass. */
  withoutArt(): Song[] {
    return this.#withoutArt.all().map(toSong)
  }

  /**
   * The next song after `afterId` the release-year pass has to ask about
   * (services/releaseYears.ts). `edited` is a year someone typed, which the
   * pass leaves alone.
   */
  nextYearToCheck(afterId: number): {
    id: number
    year: number | null
    sourceUrl: string | null
    edited: boolean
  } | null {
    const row = this.#nextYearToCheck.get(afterId)
    return row
      ? { id: row.id, year: row.year, sourceUrl: row.source_url, edited: row.edited === 1 }
      : null
  }

  yearChecked(id: number): void {
    this.#yearChecked.run(id)
  }

  /** The next song whose cover has not had its colour read, as the cover is now. */
  nextWithoutCoverTone(): { id: number; artRev: number } | null {
    const row = this.#nextWithoutCoverTone.get()
    return row ? { id: row.id, artRev: row.art_rev } : null
  }

  /**
   * Keep a cover's colour, or that it has none. Only against the cover it was
   * read from: one replaced meanwhile has a newer revision, and is read again.
   */
  setCoverTone(id: number, artRev: number, tone: CoverTone | null): void {
    this.#setCoverTone.run(
      tone?.hue ?? null,
      tone?.chroma ?? null,
      tone?.palette && tone.palette.length > 0 ? JSON.stringify(tone.palette) : null,
      artRev,
      id,
      artRev,
    )
  }

  /**
   * Every song currently in the database, by path, for the inbox sweep: a
   * file at a known path is re-read only when its time has moved.
   */
  allPaths(): Map<string, { id: number; mtimeMs: number }> {
    const rows = this.#allPaths.all()
    return new Map(rows.map(row => [row.path, { id: row.id, mtimeMs: row.mtime_ms }]))
  }
}
