import type { Db } from '../db/index.js'

/**
 * Full-text search over lyric lines.
 *
 * FTS5's unicode61 tokenizer treats a run of Han or kana as a single token,
 * which would make "夜空" only match lines that *start* with it. So the
 * indexed column holds the line with every CJK character separated by a
 * space, and a query is turned into a phrase of single characters — a
 * contiguous match anywhere in the line. Latin text is untouched and gets the
 * usual word-prefix behaviour.
 */

// Han (plus extension A and compatibility) and kana.
const CJK_CHAR = /([㐀-䶿一-鿿豈-﫿ぁ-ゟ゠-ヿㇰ-ㇿｦ-ﾟ])/g

/** `夜空 sky` → `夜 空 sky`: what gets indexed. */
export function tokenizeForFts(text: string): string {
  return text.replace(CJK_CHAR, ' $1 ').replace(/\s+/g, ' ').trim()
}

/**
 * Turn user input into a safe FTS5 MATCH expression.
 *
 * Every word is quoted (so operators typed by accident are literal), CJK
 * runs become character phrases, and each word is a prefix query so typing
 * feels incremental. Returns null when there is nothing to search for.
 */
export function buildLyricsMatch(query: string): string | null {
  const words = query.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  const phrases = words
    .map(word => tokenizeForFts(word).replace(/"/g, '""'))
    .filter(word => word.length > 0)
    .map(word => `"${word}"*`)
  return phrases.length > 0 ? phrases.join(' ') : null
}

/**
 * Split a line around the query for highlighting.
 *
 * Tries the whole query first, then its longest word. Done here rather than
 * with FTS5's highlight() because that would return the space-separated token
 * form, not the line as written.
 */
export function highlightMatch(
  line: string,
  query: string,
): { before: string; match: string; after: string } {
  const lower = line.toLowerCase()
  const candidates = [query.trim(), ...query.trim().split(/\s+/)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  for (const candidate of candidates) {
    const at = lower.indexOf(candidate.toLowerCase())
    if (at >= 0) {
      return {
        before: line.slice(0, at),
        match: line.slice(at, at + candidate.length),
        after: line.slice(at + candidate.length),
      }
    }
  }
  return { before: line, match: '', after: '' }
}

interface LyricsSearchRow {
  song_id: number
  line: string
}

export class LyricsSearchRepository {
  readonly #db: Db
  readonly #hash
  readonly #setHash
  readonly #clearLines
  readonly #insertLine
  readonly #search
  readonly #unindexed

  constructor(db: Db) {
    this.#db = db
    this.#hash = db.prepare<[number], { hash: string }>(
      'SELECT hash FROM lyrics_index WHERE song_id = ?',
    )
    this.#setHash = db.prepare(`
      INSERT INTO lyrics_index (song_id, hash, indexed_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT (song_id) DO UPDATE SET hash = excluded.hash, indexed_at = excluded.indexed_at
    `)
    this.#clearLines = db.prepare('DELETE FROM lyrics_fts WHERE song_id = ?')
    this.#insertLine = db.prepare(
      'INSERT INTO lyrics_fts (song_id, line_no, line, tokens) VALUES (?, ?, ?, ?)',
    )
    // One hit per song: the best-ranked matching line. FTS5's hidden `rank`
    // column is used because bm25() cannot be called inside a subquery.
    this.#search = db.prepare<[string, number], LyricsSearchRow>(`
      SELECT song_id, line
      FROM (
        SELECT song_id, line, rank,
               ROW_NUMBER() OVER (PARTITION BY song_id ORDER BY rank, line_no) AS n
        FROM lyrics_fts
        WHERE lyrics_fts MATCH ?
      )
      WHERE n = 1
      ORDER BY rank
      LIMIT ?
    `)
    this.#unindexed = db.prepare<[], { id: number }>(`
      SELECT s.id FROM songs s
      LEFT JOIN lyrics_index li ON li.song_id = s.id
      WHERE s.missing = 0 AND s.lyrics_kind != 'none' AND li.song_id IS NULL
    `)
  }

  /** Hash of the text the song was last indexed from, or null when never indexed. */
  indexedHash(songId: number): string | null {
    return this.#hash.get(songId)?.hash ?? null
  }

  /**
   * Replace a song's lines in the index. Runs in one transaction.
   *
   * The delete is skipped when there is nothing to delete. `song_id` is
   * UNINDEXED in the FTS table — it has to be, it is not what is searched — so
   * deleting by it reads every row in the table. For a song being indexed for
   * the first time that is a full scan to remove nothing, and the boot
   * backfill is mostly first-time indexing: one scan per song over a table
   * that is growing as it goes.
   */
  replace(songId: number, hash: string, lines: readonly string[]): void {
    const hadLines = this.indexedHash(songId) !== null
    this.#db.transaction(() => {
      if (hadLines) this.#clearLines.run(songId)
      lines.forEach((line, index) => {
        const tokens = tokenizeForFts(line)
        if (tokens) this.#insertLine.run(songId, index, line, tokens)
      })
      this.#setHash.run(songId, hash)
    })()
  }

  remove(songId: number): void {
    this.#db.transaction(() => {
      this.#clearLines.run(songId)
      this.#db.prepare('DELETE FROM lyrics_index WHERE song_id = ?').run(songId)
    })()
  }

  search(query: string, limit = 20): LyricsSearchRow[] {
    const match = buildLyricsMatch(query)
    if (!match) return []
    try {
      return this.#search.all(match, limit)
    } catch {
      // A malformed MATCH expression should degrade to "no results", never 500.
      return []
    }
  }

  /** Songs that claim to have lyrics but have never been indexed. */
  unindexedSongIds(): number[] {
    return this.#unindexed.all().map(row => row.id)
  }
}
