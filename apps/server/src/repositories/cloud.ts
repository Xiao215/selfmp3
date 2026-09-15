import {
  DoormanStorageSchema,
  newCloudDeviceId,
  type CloudLyrics,
  type DoormanStorage,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'

/**
 * All SQL for the cloud bucket: the connection, this server's name in the
 * bucket, and the bookkeeping that keeps the sync from re-reading files it
 * has already uploaded. See docs/SYNC.md.
 */

/** Where the bucket is and the key that opens it. Lives in `secrets`. */
export interface CloudConnection {
  /** `https://s3.us-west-004.backblazeb2.com` */
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  /** The folder everything goes under, without slashes at either end. Empty for the root. */
  readonly prefix: string
  readonly keyId: string
  readonly applicationKey: string
}

/** What was uploaded for one song, and from which state of it. */
export interface CloudSongState {
  readonly songId: number
  readonly audioKey: string
  readonly audioSize: number
  readonly audioSig: string
  readonly coverKey: string | null
  readonly coverSize: number | null
  readonly coverSig: string
  readonly lyricsKey: string | null
  readonly lyricsSize: number | null
  readonly lyricsKind: CloudLyrics['kind'] | null
  /** The words' romanized lines, uploaded beside them; null when they need none. */
  readonly romanizedKey: string | null
  readonly lyricsSig: string
  /** The song's motion curve (`lyrics/<sha256>.json`), or null before analysis has made one. */
  readonly motionKey: string | null
  readonly motionSig: string
}

/** What the sync needs to know about a song's files, straight from its row. */
export interface SongFileInfo {
  readonly id: number
  readonly uid: string
  readonly title: string
  readonly path: string
  readonly mime: string
  readonly sizeBytes: number
  readonly mtimeMs: number
  readonly hasArt: boolean
  readonly artRev: number
  readonly missing: boolean
}

/**
 * Signed in through the doorman: a session for your Google account, which the
 * doorman exchanges for access to the bucket that belongs to it. No bucket
 * key is held here in this mode.
 */
export interface DoormanSession {
  /** The doorman it was issued by; a session means nothing to any other. */
  readonly url: string
  readonly token: string
  readonly email: string
  readonly name: string | null
  readonly picture: string | null
  /**
   * The bucket the doorman last said belongs to the account, so a restart
   * can carry on publishing before the doorman has been asked again.
   */
  readonly storage: DoormanStorage | null
}

/** Which bucket and folder the upload bookkeeping describes. */
export interface CloudTarget {
  readonly endpoint: string
  readonly bucket: string
  readonly prefix: string
}

const CONNECTION_SECRET = 'cloud.connection'
const DOORMAN_SECRET = 'cloud.doorman'
const TARGET_SECRET = 'cloud.target'
const DEVICE_SECRET = 'cloud.device'

interface SongFileRow {
  id: number
  uid: string
  title: string
  path: string
  mime: string
  size_bytes: number
  mtime_ms: number
  has_art: number
  art_rev: number
  missing: number
}

const SONG_FILE_SELECT =
  'SELECT id, uid, title, path, mime, size_bytes, mtime_ms, has_art, art_rev, missing FROM songs'

function toSongFile(row: SongFileRow): SongFileInfo {
  return {
    id: row.id,
    uid: row.uid,
    title: row.title,
    path: row.path,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    mtimeMs: row.mtime_ms,
    hasArt: row.has_art === 1,
    artRev: row.art_rev,
    missing: row.missing === 1,
  }
}

interface CloudSongRow {
  song_id: number
  audio_key: string
  audio_size: number
  audio_sig: string
  cover_key: string | null
  cover_size: number | null
  cover_sig: string
  lyrics_key: string | null
  lyrics_size: number | null
  lyrics_kind: string | null
  romanized_key: string | null
  lyrics_sig: string
  motion_key: string | null
  motion_sig: string
}

export class CloudRepository {
  readonly #db: Db
  readonly #getSecret
  readonly #setSecret
  readonly #deleteSecret
  readonly #songFiles
  readonly #songFile
  readonly #states
  readonly #saveState
  readonly #hasFile
  readonly #recordFile

  constructor(db: Db) {
    this.#db = db
    this.#getSecret = db.prepare<[string], { value: string }>(
      'SELECT value FROM secrets WHERE name = ?',
    )
    this.#setSecret = db.prepare(`
      INSERT INTO secrets (name, value) VALUES (?, ?)
      ON CONFLICT (name) DO UPDATE SET value = excluded.value
    `)
    this.#deleteSecret = db.prepare('DELETE FROM secrets WHERE name = ?')

    this.#songFiles = db.prepare<[], SongFileRow>(`${SONG_FILE_SELECT} ORDER BY id`)
    this.#songFile = db.prepare<[number], SongFileRow>(`${SONG_FILE_SELECT} WHERE id = ?`)

    this.#states = db.prepare<[], CloudSongRow>('SELECT * FROM cloud_songs')
    this.#saveState = db.prepare(`
      INSERT INTO cloud_songs (
        song_id, audio_key, audio_size, audio_sig, cover_key, cover_size, cover_sig,
        lyrics_key, lyrics_size, lyrics_kind, romanized_key, lyrics_sig,
        motion_key, motion_sig, uploaded_at
      ) VALUES (
        @songId, @audioKey, @audioSize, @audioSig, @coverKey, @coverSize, @coverSig,
        @lyricsKey, @lyricsSize, @lyricsKind, @romanizedKey, @lyricsSig,
        @motionKey, @motionSig, datetime('now')
      )
      ON CONFLICT (song_id) DO UPDATE SET
        audio_key = excluded.audio_key, audio_size = excluded.audio_size,
        audio_sig = excluded.audio_sig, cover_key = excluded.cover_key,
        cover_size = excluded.cover_size, cover_sig = excluded.cover_sig,
        lyrics_key = excluded.lyrics_key, lyrics_size = excluded.lyrics_size,
        lyrics_kind = excluded.lyrics_kind, romanized_key = excluded.romanized_key,
        lyrics_sig = excluded.lyrics_sig, motion_key = excluded.motion_key,
        motion_sig = excluded.motion_sig, uploaded_at = excluded.uploaded_at
    `)
    this.#hasFile = db.prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM cloud_files WHERE key = ?',
    )
    this.#recordFile = db.prepare(`
      INSERT INTO cloud_files (key, size) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET size = excluded.size
    `)
  }

  // --- The connection ------------------------------------------------------

  connection(): CloudConnection | null {
    const row = this.#getSecret.get(CONNECTION_SECRET)
    if (!row) return null
    try {
      const parsed = JSON.parse(row.value) as Partial<CloudConnection>
      if (
        typeof parsed.endpoint === 'string' &&
        typeof parsed.region === 'string' &&
        typeof parsed.bucket === 'string' &&
        typeof parsed.prefix === 'string' &&
        typeof parsed.keyId === 'string' &&
        typeof parsed.applicationKey === 'string'
      ) {
        return parsed as CloudConnection
      }
    } catch {
      // A corrupt row reads as "not connected", never as a crash at boot.
    }
    return null
  }

  /**
   * Save a connection made directly with the bucket's key. It replaces any
   * doorman sign-in: one way in at a time.
   */
  saveConnection(connection: CloudConnection): void {
    this.#db.transaction(() => {
      this.adoptTarget(connection)
      this.#deleteSecret.run(DOORMAN_SECRET)
      this.#setSecret.run(CONNECTION_SECRET, JSON.stringify(connection))
    })()
  }

  /** Stop using the cloud, whichever way in. The bucket itself is left exactly as it is. */
  clearConnection(): void {
    this.#db.transaction(() => {
      this.#deleteSecret.run(CONNECTION_SECRET)
      this.#deleteSecret.run(DOORMAN_SECRET)
      this.#deleteSecret.run(TARGET_SECRET)
      this.#forgetUploads()
    })()
  }

  doormanSession(): DoormanSession | null {
    const row = this.#getSecret.get(DOORMAN_SECRET)
    if (!row) return null
    try {
      const parsed = JSON.parse(row.value) as Partial<DoormanSession>
      if (
        typeof parsed.url === 'string' &&
        typeof parsed.token === 'string' &&
        typeof parsed.email === 'string'
      ) {
        const storage = DoormanStorageSchema.safeParse(parsed.storage)
        return {
          url: parsed.url,
          token: parsed.token,
          email: parsed.email,
          name: typeof parsed.name === 'string' ? parsed.name : null,
          picture: typeof parsed.picture === 'string' ? parsed.picture : null,
          storage: storage.success ? storage.data : null,
        }
      }
    } catch {
      // As for the connection: corrupt reads as signed out.
    }
    return null
  }

  /** Signed in through the doorman. It replaces a direct connection. */
  saveDoormanSession(session: DoormanSession): void {
    this.#db.transaction(() => {
      this.#deleteSecret.run(CONNECTION_SECRET)
      this.#setSecret.run(DOORMAN_SECRET, JSON.stringify(session))
    })()
  }

  /**
   * The bucket and folder uploads now go to. Pointed somewhere else than
   * before, everything remembered about the old one is forgotten, so the next
   * pass uploads the library to where it now belongs instead of assuming it
   * is already there. A new key, or a new sign-in, for the same bucket keeps
   * it all.
   */
  adoptTarget(target: CloudTarget): void {
    const fingerprint = JSON.stringify([target.endpoint, target.bucket, target.prefix])
    this.#db.transaction(() => {
      if (this.#getSecret.get(TARGET_SECRET)?.value === fingerprint) return
      this.#forgetUploads()
      this.#setSecret.run(TARGET_SECRET, fingerprint)
    })()
  }

  /** Everything this server knows about one bucket: what it uploaded, and how far it read the logs. */
  #forgetUploads(): void {
    this.#db.exec(
      'DELETE FROM cloud_songs; DELETE FROM cloud_files; DELETE FROM cloud_log_cursors;',
    )
  }

  /** This server's name in the bucket, made the first time it is asked for. */
  deviceId(kind: string): string {
    const existing = this.#getSecret.get(DEVICE_SECRET)?.value
    if (existing) return existing
    const id = newCloudDeviceId(kind)
    this.#setSecret.run(DEVICE_SECRET, id)
    return id
  }

  // --- Bookkeeping ---------------------------------------------------------

  songFiles(): SongFileInfo[] {
    return this.#songFiles.all().map(toSongFile)
  }

  songFile(id: number): SongFileInfo | null {
    const row = this.#songFile.get(id)
    return row ? toSongFile(row) : null
  }

  states(): Map<number, CloudSongState> {
    const states = new Map<number, CloudSongState>()
    for (const row of this.#states.all()) {
      states.set(row.song_id, {
        songId: row.song_id,
        audioKey: row.audio_key,
        audioSize: row.audio_size,
        audioSig: row.audio_sig,
        coverKey: row.cover_key,
        coverSize: row.cover_size,
        coverSig: row.cover_sig,
        lyricsKey: row.lyrics_key,
        lyricsSize: row.lyrics_size,
        lyricsKind:
          row.lyrics_kind === 'plain' || row.lyrics_kind === 'synced' ? row.lyrics_kind : null,
        romanizedKey: row.romanized_key,
        lyricsSig: row.lyrics_sig,
        motionKey: row.motion_key,
        motionSig: row.motion_sig,
      })
    }
    return states
  }

  saveState(state: CloudSongState): void {
    this.#saveState.run(state)
  }

  hasFile(key: string): boolean {
    return (this.#hasFile.get(key)?.n ?? 0) > 0
  }

  recordFile(key: string, size: number): void {
    this.#recordFile.run(key, size)
  }

  /**
   * Line the bookkeeping up with what the bucket really holds, given every
   * file key it lists. A file this server thought it had uploaded but the bucket
   * has lost is forgotten, and so is every song that pointed at one — so the
   * next pass uploads them again instead of publishing snapshots that name
   * files nobody can download. Files the bucket has that were not known are
   * remembered, which saves asking about them one at a time later.
   *
   * Returns how many songs will be uploaded again.
   */
  reconcileFiles(present: ReadonlyMap<string, number>): number {
    return this.#db.transaction(() => {
      const known = this.#db.prepare<[], { key: string }>('SELECT key FROM cloud_files').all()
      const drop = this.#db.prepare('DELETE FROM cloud_files WHERE key = ?')
      for (const { key } of known) if (!present.has(key)) drop.run(key)
      for (const [key, size] of present) this.#recordFile.run(key, size)

      return this.#db
        .prepare(
          `DELETE FROM cloud_songs
            WHERE audio_key NOT IN (SELECT key FROM cloud_files)
               OR (cover_key IS NOT NULL AND cover_key NOT IN (SELECT key FROM cloud_files))
               OR (lyrics_key IS NOT NULL AND lyrics_key NOT IN (SELECT key FROM cloud_files))
               OR (romanized_key IS NOT NULL AND romanized_key NOT IN (SELECT key FROM cloud_files))
               OR (motion_key IS NOT NULL AND motion_key NOT IN (SELECT key FROM cloud_files))`,
        )
        .run().changes
    })()
  }

  /**
   * Songs whose file is on this server, how many of them have their audio in
   * the bucket, and the size of everything this server has uploaded.
   */
  totals(): { songs: number; songsInCloud: number; bytes: number } {
    const row = this.#db
      .prepare<[], { songs: number; in_cloud: number; bytes: number | null }>(
        `SELECT
           (SELECT COUNT(*) FROM songs WHERE missing = 0) AS songs,
           (SELECT COUNT(*) FROM cloud_songs c JOIN songs s ON s.id = c.song_id
             WHERE s.missing = 0) AS in_cloud,
           (SELECT SUM(size) FROM cloud_files) AS bytes`,
      )
      .get()
    return { songs: row?.songs ?? 0, songsInCloud: row?.in_cloud ?? 0, bytes: row?.bytes ?? 0 }
  }

  tagUids(): Map<number, string> {
    const rows = this.#db.prepare<[], { id: number; uid: string }>('SELECT id, uid FROM tags').all()
    return new Map(rows.map(row => [row.id, row.uid]))
  }

  playlistUids(): Map<number, string> {
    const rows = this.#db
      .prepare<[], { id: number; uid: string }>('SELECT id, uid FROM playlists')
      .all()
    return new Map(rows.map(row => [row.id, row.uid]))
  }
}
