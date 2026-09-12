import type { Song, SongPatch } from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import { toSong, type SongRow } from '../db/rows.js'

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
  LEFT JOIN song_features f ON f.song_id = s.id
`

export interface NewSong {
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
  readonly #updateScanned
  readonly #markMissing
  readonly #clearMissing
  readonly #setPath
  readonly #setSourceUrl
  readonly #deleteById
  readonly #recordPlay
  readonly #recordSkip
  readonly #setArt
  readonly #setLyricsKind
  readonly #setInstrumental
  readonly #search
  readonly #count
  readonly #manifest

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
             missing     = 0,
             updated_at  = datetime('now')
       WHERE id = @id
    `)

    this.#markMissing = db.prepare('UPDATE songs SET missing = 1 WHERE path = ?')
    this.#clearMissing = db.prepare('UPDATE songs SET missing = 0 WHERE id = ?')
    this.#setPath = db.prepare('UPDATE songs SET path = ? WHERE id = ?')
    this.#setSourceUrl = db.prepare('UPDATE songs SET source_url = ? WHERE id = ?')
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
    this.#setLyricsKind = db.prepare('UPDATE songs SET lyrics_kind = ? WHERE id = ?')
    this.#setInstrumental = db.prepare('UPDATE songs SET instrumental = ? WHERE id = ?')

    // FTS5 with a bm25 ranking. Column weights bias toward title matches,
    // which is what people mean when they half-remember a song.
    this.#search = db.prepare<[string, number], SongRow>(`
      ${SONG_SELECT}
      JOIN songs_fts ON songs_fts.rowid = s.id
      WHERE songs_fts MATCH ?
      ORDER BY bm25(songs_fts, 10.0, 5.0, 1.0)
      LIMIT ?
    `)

    this.#count = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM songs')
    this.#manifest = db.prepare<[], { id: number; size_bytes: number; mtime_ms: number }>(
      'SELECT id, size_bytes, mtime_ms FROM songs WHERE missing = 0 ORDER BY id',
    )
  }

  all(): Song[] {
    return this.#all.all().map(toSong)
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
    this.#db
      .prepare(`UPDATE songs SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = @id`)
      .run(values)
  }

  markMissing(path: string): void {
    this.#markMissing.run(path)
  }

  clearMissing(id: number): void {
    this.#clearMissing.run(id)
  }

  /**
   * The file moved, and the song goes with it. The scanner knows songs by
   * path, so without this a moved file would come back as a new song and the
   * old one, tags and plays and all, would be marked missing.
   */
  setPath(id: number, path: string): void {
    this.#setPath.run(path, id)
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

    const statement = this.#db.prepare(
      "UPDATE songs SET loved = ?, updated_at = datetime('now') WHERE id = ? AND loved != ?",
    )
    const value = loved ? 1 : 0

    const run = this.#db.transaction((unique: readonly number[]) => {
      let affected = 0
      for (const id of unique) affected += statement.run(value, id, value).changes
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

  setLyricsKind(id: number, kind: string): void {
    this.#setLyricsKind.run(kind, id)
  }

  /** Remember (or forget) that a song has no words, so lyrics are not looked up. */
  setInstrumental(id: number, on: boolean): void {
    this.#setInstrumental.run(on ? 1 : 0, id)
  }

  /**
   * Full-text search.
   *
   * User input is turned into a prefix query per token and every token is
   * quoted, so FTS5 operators typed by accident (`*`, `NEAR`, an unbalanced
   * quote) are treated as literal text instead of blowing up the query.
   */
  search(query: string, limit = 50): Song[] {
    const tokens = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(token => `"${token.replace(/"/g, '""')}"*`)
    if (tokens.length === 0) return []
    try {
      return this.#search.all(tokens.join(' '), limit).map(toSong)
    } catch {
      // A malformed MATCH expression should degrade to "no results", never 500.
      return []
    }
  }

  count(): number {
    return this.#count.get()?.n ?? 0
  }

  /** Compact list used by the phone to work out what it still needs to cache. */
  manifest(): Array<{ id: number; sizeBytes: number; etag: string }> {
    return this.#manifest.all().map(row => ({
      id: row.id,
      sizeBytes: row.size_bytes,
      etag: `"${row.size_bytes.toString(16)}-${row.mtime_ms.toString(16)}"`,
    }))
  }

  /** Songs with no cover art whose file is present, for the cover-art pass. */
  withoutArt(): Song[] {
    return this.#db
      .prepare<[], SongRow>(`${SONG_SELECT} WHERE s.has_art = 0 AND s.missing = 0 ORDER BY s.id`)
      .all()
      .map(toSong)
  }

  /** Paths of every song currently in the database, for scan reconciliation. */
  allPaths(): Map<string, { id: number; mtimeMs: number }> {
    const rows = this.#db
      .prepare<[], { id: number; path: string; mtime_ms: number }>(
        'SELECT id, path, mtime_ms FROM songs',
      )
      .all()
    return new Map(rows.map(row => [row.path, { id: row.id, mtimeMs: row.mtime_ms }]))
  }
}
