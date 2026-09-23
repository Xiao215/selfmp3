import { parseLyrics, type LyricsSearchHit, type Song } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { SongRepository } from '../repositories/songs.js'
import { highlightMatch, type LyricsSearchRepository } from '../repositories/lyricsSearch.js'
import type { LyricsService } from './lyrics.js'
import type { MetadataService } from './metadata.js'
import { LyricsCache } from './lyricsCache.js'

/**
 * Keeps the lyric search index in step with the lyrics the server holds.
 *
 * Indexing happens whenever lyrics are resolved or saved, plus a one-off
 * backfill after boot for songs the scanner knows have lyrics but that nobody
 * has opened yet. Each song is indexed from a hash of its text, so re-indexing
 * an unchanged song is a single row lookup.
 */
export class LyricsIndexService {
  readonly #songs: SongRepository
  readonly #search: LyricsSearchRepository
  readonly #lyrics: LyricsService
  readonly #metadata: MetadataService
  readonly #logger: Logger
  #backfilling = false

  constructor(deps: {
    songs: SongRepository
    search: LyricsSearchRepository
    lyrics: LyricsService
    metadata: MetadataService
    logger: Logger
  }) {
    this.#songs = deps.songs
    this.#search = deps.search
    this.#lyrics = deps.lyrics
    this.#metadata = deps.metadata
    this.#logger = deps.logger.child('lyrics-index')
  }

  /** Index a song's lyrics text. Cheap when the text has not changed. */
  index(songId: number, text: string): void {
    const hash = LyricsCache.hash(text)
    if (this.#search.indexedHash(songId) === hash) return
    const parsed = parseLyrics(text)
    const lines = parsed.synced ? parsed.lines.map(line => line.text) : parsed.lines
    this.#search.replace(songId, hash, lines)
  }

  remove(songId: number): void {
    this.#search.remove(songId)
  }

  search(query: string, limit: number): LyricsSearchHit[] {
    const hits: LyricsSearchHit[] = []
    for (const row of this.#search.search(query, limit)) {
      const song = this.#songs.byId(row.song_id)
      if (!song) continue
      hits.push({
        songId: song.id,
        title: song.title,
        artist: song.artist,
        hasArt: song.hasArt,
        line: row.line,
        ...highlightMatch(row.line, query),
      })
    }
    return hits
  }

  /** Sidecar, the bucket's copy, or embedded text — no network, this runs unattended. */
  async #localText(song: Song): Promise<string | null> {
    const stored = await this.#lyrics.stored(song.id, song.path)
    if (stored) return stored.text
    const metadata = await this.#metadata.read(song.path).catch(() => null)
    return metadata?.embeddedLyrics?.trim() ? metadata.embeddedLyrics : null
  }

  /**
   * Index every song that has lyrics but no index row yet. Runs in the
   * background; safe to call repeatedly (after a scan, say).
   */
  async backfill(): Promise<number> {
    if (this.#backfilling) return 0
    this.#backfilling = true
    let indexed = 0
    try {
      for (const id of this.#search.unindexedSongIds()) {
        const song = this.#songs.byId(id)
        if (!song) continue
        const text = await this.#localText(song)
        if (!text) continue
        this.index(id, text)
        indexed++
      }
    } catch (error) {
      this.#logger.warn('lyrics backfill stopped early', {
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.#backfilling = false
    }
    if (indexed > 0) this.#logger.info('lyrics indexed', { songs: indexed })
    return indexed
  }
}
