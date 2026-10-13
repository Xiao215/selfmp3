import {
  SmartRulesSchema,
  inKeptOrder,
  insertedAt,
  livePlaylistSongs,
  playlistRules,
  reordered,
  toCloudRules,
  type PlaylistRules,
  type CreatePlaylist,
  type Playlist,
  type RuleSong,
  type SmartRules,
  type UpdatePlaylist,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import type { PlaylistRow } from '../db/rows.js'

/** A song as a live playlist's rules read it, straight from the database. */
interface RuleSongRow {
  id: number
  uid: string
  title: string
  artist: string
  album: string
  album_artist: string
  play_count: number
  duration: number
  year: number | null
  added_at: string
  last_played_at: string | null
  loved: number
  lyrics_key: string | null
  lyrics_kind: string | null
  cover_key: string | null
  analyzed_at: string | null
  bpm: number | null
  energy: number | null
  loudness_lufs: number | null
  camelot: string | null
  tag_uids: string | null
}

/** Every song as the rules read it, and the ways back to this server's ids. */
interface RuleFacts {
  readonly songs: readonly RuleSong[]
  readonly idOf: ReadonlyMap<string, number>
  readonly durationOf: ReadonlyMap<number, number>
  readonly tagUid: ReadonlyMap<number, string>
}

/** A playlist row with its counts, as both reads of whole playlists want it. */
const PLAYLIST_SELECT = `
  SELECT p.*,
         (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = p.id) AS song_count,
         (SELECT COALESCE(SUM(s.duration), 0)
            FROM playlist_items pi JOIN songs s ON s.id = pi.song_id
           WHERE pi.playlist_id = p.id) AS total_duration
  FROM playlists p
`

/**
 * Playlists, both kinds.
 *
 * A manual playlist stores an ordered list of song ids. A live playlist
 * stores a rule set and resolves to song ids on demand, so it stays correct as
 * the library changes without anyone having to refresh it — with the one
 * evaluator every device runs (shared smartRules.ts), over the same facts the
 * snapshot gives them, so a phone and this server agree on its songs.
 */
export class PlaylistRepository {
  readonly #db: Db

  readonly #all
  readonly #byId
  readonly #insert
  readonly #delete
  readonly #items
  readonly #maxPosition
  readonly #insertItem
  readonly #removeItem
  readonly #clearItems
  readonly #insertSynced
  readonly #setUpdatedAt
  readonly #makeManual
  readonly #markPlayed
  readonly #touch
  readonly #kinds
  readonly #ruleSongs
  readonly #tagUids
  readonly #changed
  #factsCache: { key: string; facts: RuleFacts } | null = null

  constructor(db: Db) {
    this.#db = db

    this.#all = db.prepare<[], PlaylistRow>(
      `${PLAYLIST_SELECT} ORDER BY p.pinned DESC, p.name COLLATE NOCASE`,
    )
    this.#byId = db.prepare<[number], PlaylistRow>(`${PLAYLIST_SELECT} WHERE p.id = ?`)

    this.#insert = db.prepare(`
      INSERT INTO playlists (name, description, kind, rules)
      VALUES (@name, @description, @kind, @rules)
    `)

    this.#delete = db.prepare('DELETE FROM playlists WHERE id = ?')

    this.#items = db.prepare<[number], { song_id: number }>(`
      SELECT song_id
        FROM playlist_items
       WHERE playlist_id = ?
       ORDER BY position, rowid
    `)

    this.#maxPosition = db.prepare<[number], { max: number | null }>(
      'SELECT MAX(position) AS max FROM playlist_items WHERE playlist_id = ?',
    )

    this.#insertItem = db.prepare(`
      INSERT INTO playlist_items (playlist_id, song_id, position)
      VALUES (?, ?, ?)
      ON CONFLICT (playlist_id, song_id) DO NOTHING
    `)

    this.#removeItem = db.prepare(
      'DELETE FROM playlist_items WHERE playlist_id = ? AND song_id = ?',
    )
    this.#clearItems = db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?')
    this.#insertSynced = db.prepare(
      `INSERT INTO playlists (uid, name, description, kind, rules, pinned, created_at, updated_at)
       VALUES (@uid, @name, @description, @kind, @rules, @pinned, @createdAt, @createdAt)`,
    )
    this.#setUpdatedAt = db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?')
    this.#makeManual = db.prepare(
      "UPDATE playlists SET kind = 'manual', rules = NULL, updated_at = datetime('now') WHERE id = ?",
    )
    this.#markPlayed = db.prepare(
      "UPDATE playlists SET last_played_at = datetime('now') WHERE id = ?",
    )
    this.#touch = db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?")
    this.#kinds = db.prepare<[], { id: number; kind: string; rules: string | null }>(
      'SELECT id, kind, rules FROM playlists',
    )
    this.#ruleSongs = db.prepare<[], RuleSongRow>(`
      SELECT s.id, s.uid, s.title, s.artist, s.album, s.album_artist, s.play_count,
             s.duration, s.year, s.added_at, s.last_played_at, s.loved,
             c.lyrics_key, c.lyrics_kind, c.cover_key,
             f.analyzed_at, f.bpm, f.energy, f.loudness_lufs, f.camelot,
             (SELECT GROUP_CONCAT(t.uid) FROM song_tags st JOIN tags t ON t.id = st.tag_id
               WHERE st.song_id = s.id) AS tag_uids
        FROM songs s
        LEFT JOIN cloud_songs c ON c.song_id = s.id
        LEFT JOIN song_audio_features f ON f.song_id = s.id
    `)
    this.#tagUids = db.prepare<[], { id: number; uid: string }>('SELECT id, uid FROM tags')
    this.#changed = db.prepare<[], { writes: number; others: number }>(
      'SELECT total_changes() AS writes, (SELECT data_version FROM pragma_data_version) AS others',
    )
  }

  /**
   * Parse stored rules defensively. A rule set written by a newer version, or
   * hand-edited in the database, must not take the whole playlist list down.
   */
  #parseRules(raw: string | null): SmartRules | null {
    if (!raw) return null
    try {
      const parsed = SmartRulesSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  #toPlaylist(row: PlaylistRow): Playlist {
    // A live row whose rules will not parse reads as a manual playlist with
    // nothing in it: visible, harmless, and the one shape a live playlist
    // without rules cannot be.
    const shape = playlistRules(
      row.kind === 'live' ? 'live' : 'manual',
      row.kind === 'live' ? this.#parseRules(row.rules) : null,
    )

    // A live playlist's counts come from evaluating its rules, not from the
    // (always empty) items table.
    let songCount = row.song_count ?? 0
    let totalDuration = row.total_duration ?? 0
    if (shape.kind === 'live') {
      const stats = this.#liveStats(shape.rules)
      songCount = stats.count
      totalDuration = stats.duration
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ...shape,
      songCount,
      totalDuration,
      pinned: row.pinned === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastPlayedAt: row.last_played_at ?? null,
    }
  }

  /**
   * What every rule reads of every song, read again only when the database
   * has changed since: a library read asks each live playlist in turn, and a
   * snapshot each one again. `total_changes()` moves with every write on this
   * connection, `data_version` with any on another.
   */
  #facts(): RuleFacts {
    const changed = this.#changed.get()
    const key = `${changed?.writes ?? 0}:${changed?.others ?? 0}`
    if (this.#factsCache?.key === key) return this.#factsCache.facts
    const songs: RuleSong[] = []
    const idOf = new Map<string, number>()
    const durationOf = new Map<number, number>()
    for (const row of this.#ruleSongs.all()) {
      idOf.set(row.uid, row.id)
      durationOf.set(row.id, row.duration)
      songs.push({
        uid: row.uid,
        title: row.title,
        artist: row.artist,
        album: row.album,
        albumArtist: row.album_artist,
        tagUids: row.tag_uids ? row.tag_uids.split(',') : [],
        playCount: row.play_count,
        duration: row.duration,
        year: row.year,
        addedAt: row.added_at,
        lastPlayedAt: row.last_played_at,
        loved: row.loved === 1,
        // As the snapshot carries them (`buildSnapshot`): what the bucket has.
        lyrics:
          row.lyrics_key !== null && row.lyrics_kind !== null ? { key: row.lyrics_key } : null,
        cover: row.cover_key !== null ? { key: row.cover_key } : null,
        audioFeatures:
          row.analyzed_at === null
            ? null
            : {
                bpm: row.bpm,
                energy: row.energy,
                loudnessLufs: row.loudness_lufs,
                camelot: row.camelot,
              },
      })
    }
    const tagUid = new Map(this.#tagUids.all().map(row => [row.id, row.uid]))
    const facts = { songs, idOf, durationOf, tagUid }
    this.#factsCache = { key, facts }
    return facts
  }

  /** The songs a rule set matches, by id, in the rule's own order (shared `livePlaylistSongs`). */
  #matched(rules: SmartRules): number[] {
    const { songs, idOf, tagUid } = this.#facts()
    const cloudRules = toCloudRules(rules, id => tagUid.get(id) ?? null)
    return livePlaylistSongs(cloudRules, songs).flatMap(uid => idOf.get(uid) ?? [])
  }

  #liveStats(rules: SmartRules): { count: number; duration: number } {
    const { durationOf } = this.#facts()
    const matched = this.#matched(rules)
    return {
      count: matched.length,
      duration: matched.reduce((sum, id) => sum + (durationOf.get(id) ?? 0), 0),
    }
  }

  all(): Playlist[] {
    return this.#all.all().map(row => this.#toPlaylist(row))
  }

  byId(id: number): Playlist | null {
    const row = this.#byId.get(id)
    return row ? this.#toPlaylist(row) : null
  }

  create(input: CreatePlaylist): Playlist {
    const info = this.#insert.run({
      name: input.name,
      description: input.description,
      kind: input.kind,
      rules: input.rules ? JSON.stringify(input.rules) : null,
    })
    const created = this.byId(Number(info.lastInsertRowid))
    if (!created) throw new Error('failed to create playlist')
    return created
  }

  /** A playlist made on another device: its uid, and dated by when it was made there. */
  insertSynced(
    input: {
      uid: string
      name: string
      description: string
      pinned: boolean
      createdAt: string
    } & PlaylistRules,
  ): number {
    const info = this.#insertSynced.run({
      ...input,
      rules: input.rules ? JSON.stringify(input.rules) : null,
      pinned: input.pinned ? 1 : 0,
    })
    return Number(info.lastInsertRowid)
  }

  /**
   * For an edit from another device, dated by when it was made there rather
   * than when it arrived. The methods above date an edit "now" themselves;
   * this comes after them and says otherwise.
   */
  setUpdatedAt(id: number, updatedAt: string): void {
    this.#setUpdatedAt.run(updatedAt, id)
  }

  update(id: number, patch: UpdatePlaylist): Playlist | null {
    const assignments: string[] = []
    const values: Record<string, unknown> = { id }

    if (patch.name !== undefined) {
      assignments.push('name = @name')
      values['name'] = patch.name
    }
    if (patch.description !== undefined) {
      assignments.push('description = @description')
      values['description'] = patch.description
    }
    if (patch.rules !== undefined) {
      assignments.push('rules = @rules')
      values['rules'] = patch.rules ? JSON.stringify(patch.rules) : null
    }
    if (patch.pinned !== undefined) {
      assignments.push('pinned = @pinned')
      values['pinned'] = patch.pinned ? 1 : 0
    }

    if (assignments.length > 0) {
      this.#db
        .prepare(
          `UPDATE playlists SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = @id`,
        )
        .run(values)
    }
    return this.byId(id)
  }

  /**
   * Stop a playlist following its tags, keeping `keep` as its songs: the ones
   * it shows right now (`songIds`), or the ones the device that stopped it
   * showed (`playlistUnfollowed`).
   *
   * The songs a live playlist shows are the answer to its rules, worked out on
   * every read and stored nowhere — so switching it off without writing them
   * down first would empty it. This writes them as the playlist's own items
   * in that order, and only then changes the kind. One transaction: a crash
   * half-way through would otherwise leave a playlist that is neither.
   */
  stopFollowing(
    playlist: { readonly id: number; readonly kind: Playlist['kind'] },
    keep: readonly number[],
  ): void {
    if (playlist.kind !== 'live') return
    this.#db.transaction(() => {
      this.#replaceItems(playlist.id, keep)
      this.#makeManual.run(playlist.id)
    })()
  }

  delete(id: number): void {
    this.#delete.run(id)
  }

  /**
   * Note that the playlist was just started. Leaves `updated_at` alone:
   * playing a list is not editing it, and sync reads that column as "changed".
   */
  markPlayed(id: number): void {
    this.#markPlayed.run(id)
  }

  /** Ordered song ids, resolving a live playlist's rules on the fly. */
  songIds(playlist: Pick<Playlist, 'id' | 'kind' | 'rules'>): number[] {
    if (playlist.kind === 'live') {
      if (!playlist.rules) return []
      // In the order kept by hand, which the playlist's own items hold.
      return inKeptOrder(this.#itemIds(playlist.id), this.#matched(playlist.rules))
    }
    return this.#itemIds(playlist.id)
  }

  #itemIds(playlistId: number): number[] {
    return this.#items.all(playlistId).map(row => row.song_id)
  }

  /**
   * Every song in at least one playlist, live ones resolved as they stand.
   * Without the counts `all()` works out for every live playlist, which a
   * caller after only the ids would pay for and throw away.
   */
  everySongId(): Set<number> {
    const ids = new Set<number>()
    for (const row of this.#kinds.all()) {
      const shape = playlistRules(
        row.kind === 'live' ? 'live' : 'manual',
        row.kind === 'live' ? this.#parseRules(row.rules) : null,
      )
      for (const id of this.songIds({ id: row.id, ...shape })) ids.add(id)
    }
    return ids
  }

  /** Append or insert songs, keeping positions dense and ordered. */
  add(playlistId: number, songIds: readonly number[], position?: number): void {
    const run = this.#db.transaction(() => {
      if (position === undefined) {
        let next = (this.#maxPosition.get(playlistId)?.max ?? -1) + 1
        for (const songId of songIds) this.#insertItem.run(playlistId, songId, next++)
        return
      }

      // Inserting in the middle: rebuild the order rather than shuffling
      // positions in place, which is simpler to reason about and cheap at
      // playlist scale.
      const existing = this.#items.all(playlistId).map(row => row.song_id)
      this.#replaceItems(playlistId, insertedAt(existing, songIds, position))
    })
    run()
    this.#touch.run(playlistId)
  }

  remove(playlistId: number, songId: number): void {
    this.#removeItem.run(playlistId, songId)
    this.#touch.run(playlistId)
  }

  /**
   * Take several songs out at once. Returns how many were actually in it.
   *
   * One transaction, so a multi-select removal is one atomic edit of the
   * playlist rather than a visible cascade of single removals.
   */
  removeMany(playlistId: number, songIds: readonly number[]): number {
    if (songIds.length === 0) return 0
    const run = this.#db.transaction((ids: readonly number[]) => {
      let affected = 0
      for (const songId of ids) affected += this.#removeItem.run(playlistId, songId).changes
      return affected
    })
    const affected = run([...new Set(songIds)])
    this.#touch.run(playlistId)
    return affected
  }

  /**
   * Replace the order wholesale.
   *
   * Ids that are not currently in the playlist are ignored, and ids the client
   * did not mention are appended in their existing order — so a stale client
   * reordering an old view cannot silently delete tracks.
   *
   * A playlist that follows tags has no items of its own until the first time
   * it is put in an order by hand, so "currently in the playlist" there is the
   * rule's own answer; without that the first reorder filtered every id away
   * and stored nothing.
   */
  reorder(playlistId: number, songIds: readonly number[]): void {
    const playlist = this.byId(playlistId)
    const run = this.#db.transaction(() => {
      const existing =
        playlist && playlist.kind === 'live'
          ? this.songIds(playlist)
          : this.#items.all(playlistId).map(row => row.song_id)
      this.#replaceItems(playlistId, reordered(existing, songIds))
    })
    run()
    this.#touch.run(playlistId)
  }

  /** The playlist's own items, all of them, in this order. Caller wraps this in a transaction. */
  #replaceItems(playlistId: number, songIds: readonly number[]): void {
    this.#clearItems.run(playlistId)
    songIds.forEach((songId, index) => this.#insertItem.run(playlistId, songId, index))
  }
}
