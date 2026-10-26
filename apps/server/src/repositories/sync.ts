import type { Db } from '../db/index.js'

export type StampKind = 'song' | 'songTag' | 'tag' | 'playlist' | 'playlistSong'

export interface StampRow {
  readonly kind: StampKind
  readonly uid: string
  readonly field: string
  readonly hlc: string
}

export interface EmptiedTag {
  readonly uid: string
  readonly name: string
  readonly hue: number
}

/**
 * What this server keeps to combine its edits with every other device's
 * (docs/SYNC.md): when each edited field was last set, which tag a second
 * uid for the same name means, and how far into each device's log it has
 * read.
 */
export class SyncRepository {
  readonly #db: Db
  readonly #stamp
  readonly #setStamp
  readonly #latestStamp
  readonly #allStamps
  readonly #songId
  readonly #tag
  readonly #tagByName
  readonly #songAlias
  readonly #addSongAlias
  readonly #mergedSong
  readonly #addMerge
  readonly #repointMerges
  readonly #merges
  readonly #aliasTarget
  readonly #addAlias
  readonly #aliases
  readonly #keepEmptied
  readonly #addEmptied
  readonly #emptiedTag
  readonly #forgetEmptied
  readonly #emptiedTags
  readonly #playlist
  readonly #cursors
  readonly #setCursor

  constructor(db: Db) {
    this.#db = db
    this.#stamp = db.prepare<[string, string, string], { hlc: string }>(
      'SELECT hlc FROM sync_stamps WHERE kind = ? AND uid = ? AND field = ?',
    )
    this.#setStamp = db.prepare(`
      INSERT INTO sync_stamps (kind, uid, field, hlc) VALUES (?, ?, ?, ?)
      ON CONFLICT (kind, uid, field) DO UPDATE SET hlc = excluded.hlc
    `)
    this.#latestStamp = db.prepare<[], { hlc: string | null }>(
      'SELECT MAX(hlc) AS hlc FROM sync_stamps',
    )
    this.#allStamps = db.prepare<[], StampRow>('SELECT kind, uid, field, hlc FROM sync_stamps')
    this.#songId = db.prepare<[string], { id: number }>('SELECT id FROM songs WHERE uid = ?')
    this.#songAlias = db.prepare<[string], { id: number }>(
      'SELECT song_id AS id FROM song_aliases WHERE uid = ?',
    )
    this.#addSongAlias = db.prepare(
      'INSERT OR IGNORE INTO song_aliases (uid, song_id) VALUES (?, ?)',
    )
    this.#mergedSong = db.prepare<[string], { id: number }>(
      'SELECT song_id AS id FROM song_merges WHERE uid = ?',
    )
    this.#addMerge = db.prepare(`
      INSERT INTO song_merges (uid, song_id) VALUES (?, ?)
      ON CONFLICT (uid) DO UPDATE SET song_id = excluded.song_id
    `)
    this.#repointMerges = db.prepare('UPDATE song_merges SET song_id = ? WHERE song_id = ?')
    this.#merges = db.prepare<[], { uid: string; target: string }>(`
      SELECT m.uid, s.uid AS target FROM song_merges m JOIN songs s ON s.id = m.song_id
    `)
    this.#tag = db.prepare<[string], { id: number; name: string }>(
      'SELECT id, name FROM tags WHERE uid = ?',
    )
    this.#tagByName = db.prepare<[string], { id: number; uid: string }>(
      'SELECT id, uid FROM tags WHERE name = ? COLLATE NOCASE',
    )
    this.#aliasTarget = db.prepare<[string], { tag_id: number; uid: string }>(`
      SELECT a.tag_id, t.uid FROM tag_aliases a JOIN tags t ON t.id = a.tag_id WHERE a.uid = ?
    `)
    this.#addAlias = db.prepare(
      'INSERT INTO tag_aliases (uid, tag_id) VALUES (?, ?) ON CONFLICT (uid) DO NOTHING',
    )
    this.#aliases = db.prepare<[], { uid: string; target: string }>(`
      SELECT a.uid, t.uid AS target FROM tag_aliases a JOIN tags t ON t.id = a.tag_id
    `)
    this.#keepEmptied = db.prepare(`
      INSERT INTO emptied_tags (uid, name, hue) SELECT uid, name, hue FROM tags WHERE id = ?
      ON CONFLICT (uid) DO UPDATE SET name = excluded.name, hue = excluded.hue
    `)
    this.#addEmptied = db.prepare(
      'INSERT INTO emptied_tags (uid, name, hue) VALUES (?, ?, ?) ON CONFLICT (uid) DO NOTHING',
    )
    this.#emptiedTag = db.prepare<[string], EmptiedTag>(
      'SELECT uid, name, hue FROM emptied_tags WHERE uid = ?',
    )
    this.#forgetEmptied = db.prepare('DELETE FROM emptied_tags WHERE uid = ?')
    this.#emptiedTags = db.prepare<[], EmptiedTag>(
      'SELECT uid, name, hue FROM emptied_tags ORDER BY uid',
    )
    this.#playlist = db.prepare<[string], { id: number; kind: string; updated_at: string }>(
      'SELECT id, kind, updated_at FROM playlists WHERE uid = ?',
    )
    this.#cursors = db.prepare<[], { device: string; seq: number }>(
      'SELECT device, seq FROM cloud_log_cursors',
    )
    this.#setCursor = db.prepare(`
      INSERT INTO cloud_log_cursors (device, seq) VALUES (?, ?)
      ON CONFLICT (device) DO UPDATE SET seq = MAX(seq, excluded.seq)
    `)
  }

  // --- Stamps --------------------------------------------------------------

  stamp(kind: StampKind, uid: string, field: string): string | null {
    return this.#stamp.get(kind, uid, field)?.hlc ?? null
  }

  setStamp(kind: StampKind, uid: string, field: string, hlc: string): void {
    this.#setStamp.run(kind, uid, field, hlc)
  }

  /** The latest stamp from anywhere: where this server's clock carries on from. */
  latestStamp(): string | null {
    return this.#latestStamp.get()?.hlc ?? null
  }

  allStamps(): StampRow[] {
    return this.#allStamps.all()
  }

  /** Uids for integer ids, for stamping an edit made here. Ids that are gone are left out. */
  uids(table: 'songs' | 'tags' | 'playlists', ids: readonly number[]): Map<number, string> {
    const unique = [...new Set(ids)]
    const found = new Map<number, string>()
    // In slices, well under SQLite's limit on bound parameters.
    for (let start = 0; start < unique.length; start += 500) {
      const slice = unique.slice(start, start + 500)
      const rows = this.#db
        .prepare<number[], { id: number; uid: string }>(
          `SELECT id, uid FROM ${table} WHERE id IN (${slice.map(() => '?').join(',')})`,
        )
        .all(...slice)
      for (const row of rows) found.set(row.id, row.uid)
    }
    return found
  }

  // --- Finding things by uid -------------------------------------------------

  /** The song a uid means here: its own, or the one another server's uid was folded into. */
  songId(uid: string): number | null {
    return this.#songId.get(uid)?.id ?? this.#songAlias.get(uid)?.id ?? null
  }

  /**
   * Remember that another server calls this song by `uid`.
   *
   * Two servers that each scanned the same file gave it a uid apiece. Adoption
   * finds that out from the audio's hash (`CloudAdopt`) and records the second
   * uid here instead of making a second row, so everything that arrives naming
   * it — a change from a device that read the other server's snapshot, a
   * playlist that lists it — lands on the one song there is.
   */
  addSongAlias(uid: string, songId: number): void {
    this.#addSongAlias.run(uid, songId)
  }

  /**
   * The song a play, a tag or a playlist place naming `uid` lands on: the
   * song itself, or the one a copy of that uid was folded into (`songMerged`).
   * Never for an edit or a removal, which are about the copy that is gone.
   */
  playedSongId(uid: string): number | null {
    return this.songId(uid) ?? this.#mergedSong.get(uid)?.id ?? null
  }

  /**
   * Remember that the copy `uid` went into the song `songId`, and that every
   * copy folded into the copy before went there too. Done before the copy's
   * row goes, which would take those with it.
   */
  addMerge(uid: string, fromId: number, songId: number): void {
    this.#repointMerges.run(songId, fromId)
    this.#addMerge.run(uid, songId)
  }

  /** Every folded copy, as its uid and the uid of the song it went into. */
  merges(): Map<string, string> {
    return new Map(this.#merges.all().map(row => [row.uid, row.target]))
  }

  /** The tag a uid means here: its own, or the one it was folded into. */
  tag(uid: string): { id: number; uid: string; name: string } | null {
    const own = this.#tag.get(uid)
    if (own) return { id: own.id, uid, name: own.name }
    const alias = this.#aliasTarget.get(uid)
    if (!alias) return null
    const target = this.#tag.get(alias.uid)
    return target ? { id: target.id, uid: alias.uid, name: target.name } : null
  }

  /** A tag by name, compared the way the tags table compares names. */
  tagNamed(name: string): { id: number; uid: string } | null {
    return this.#tagByName.get(name) ?? null
  }

  addAlias(uid: string, tagId: number): void {
    this.#addAlias.run(uid, tagId)
  }

  /** Every alias, as the second uid and the uid of the tag it means. */
  aliases(): Map<string, string> {
    return new Map(this.#aliases.all().map(row => [row.uid, row.target]))
  }

  // --- Tags their last songs took with them ------------------------------------

  /**
   * Keep a tag aside, as it is, before it goes because its last songs did
   * (`tagEmptied`): a song another device tags with it brings it back.
   */
  keepEmptiedTag(tagId: number): void {
    this.#keepEmptied.run(tagId)
  }

  /** One a snapshot kept aside, for a server taking the bucket's library. */
  addEmptiedTag(tag: EmptiedTag): void {
    this.#addEmptied.run(tag.uid, tag.name, tag.hue)
  }

  emptiedTag(uid: string): EmptiedTag | null {
    return this.#emptiedTag.get(uid) ?? null
  }

  /** True when it was kept aside. */
  forgetEmptiedTag(uid: string): boolean {
    return this.#forgetEmptied.run(uid).changes > 0
  }

  emptiedTags(): EmptiedTag[] {
    return this.#emptiedTags.all()
  }

  playlist(uid: string): { id: number; kind: 'manual' | 'live'; updatedAt: string } | null {
    const row = this.#playlist.get(uid)
    if (!row) return null
    return {
      id: row.id,
      kind: row.kind === 'live' ? 'live' : 'manual',
      updatedAt: row.updated_at,
    }
  }

  // --- Reading the logs ------------------------------------------------------

  /** For each other device, the last of its log files this server has folded in. */
  cursors(): Record<string, number> {
    return Object.fromEntries(this.#cursors.all().map(row => [row.device, row.seq]))
  }

  /** Only ever moves forward. */
  setCursor(device: string, seq: number): void {
    this.#setCursor.run(device, seq)
  }
}
