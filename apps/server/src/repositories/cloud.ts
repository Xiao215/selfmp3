import path from 'node:path'
import { z } from 'zod'
import {
  DoormanStorageSchema,
  newCloudDeviceId,
  toSqliteTime,
  type CloudCoverPack,
  type CloudLyrics,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'

/**
 * All SQL for the cloud bucket: the connection, this server's name in the
 * bucket, and the bookkeeping that keeps the sync from re-reading files it
 * has already uploaded. See docs/SYNC.md.
 */

/**
 * Where the bucket is and the key that opens it. Lives in `secrets`, and is
 * read back through this schema: a row this build cannot make sense of reads
 * as "not connected", never as a crash at boot.
 */
const CloudConnectionSchema = z.object({
  /** `https://s3.us-west-004.backblazeb2.com` */
  endpoint: z.string(),
  region: z.string(),
  bucket: z.string(),
  /** The folder everything goes under, without slashes at either end. Empty for the root. */
  prefix: z.string(),
  keyId: z.string(),
  applicationKey: z.string(),
})
export type CloudConnection = Readonly<z.infer<typeof CloudConnectionSchema>>

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
  readonly lyricsSig: string
  /** The song's motion curve (`lyrics/<sha256>.json`), or null before analysis has made one. */
  readonly motionKey: string | null
  readonly motionSig: string
  /** When the audio last went up, in SQLite's UTC format. */
  readonly uploadedAt: string
}

/** An artist's picture in the bucket, and which kept copy of it went up. */
export interface CloudArtistState {
  /** `artistKey` of their name. */
  readonly artist: string
  readonly bannerKey: string
  readonly bannerSize: number
  readonly portraitKey: string
  readonly portraitSize: number
  /** The kept copy's revision (services/artistBackdrops.ts): a new picture is a new one. */
  readonly sig: string
}

interface CloudArtistRow {
  artist_key: string
  banner_key: string
  banner_size: number
  portrait_key: string
  portrait_size: number
  sig: string
}

/** The library's sound vectors in the bucket (sound/pack.ts), and which vectors went up. */
export interface CloudSoundState {
  /** The model that heard them. */
  readonly model: string
  readonly key: string
  readonly size: number
  /**
   * The vectors the file holds, as `SoundService.packSignature` puts it; empty
   * when that is not known (the file was read from the bucket, not made here),
   * so the next look packs the vectors and compares.
   */
  readonly sig: string
  /** When the file went up or was read, as an ISO time. */
  readonly uploadedAt: string
}

/** The sound map's file in the bucket (sound/soundMap.ts). */
export interface CloudSoundMapState {
  readonly key: string
  readonly size: number
}

/** One month of plays in the bucket (`CloudPlaysSchema`), and which plays went up. */
export interface CloudPlaysState {
  /** `YYYY-MM`, UTC. */
  readonly month: string
  readonly key: string
  readonly size: number
  readonly count: number
  /** The plays the file holds, as `StatsRepository.months` signs them. */
  readonly sig: string
  readonly uploadedAt: string
}

interface CloudPlaysRow {
  month: string
  key: string
  size: number
  count: number
  sig: string
  uploaded_at: string
}

interface CloudCoverPackRow {
  key: string
  size: number
  covers: string
}

interface CloudSoundRow {
  model: string
  key: string
  size: number
  sig: string
  uploaded_at: string
}

/**
 * Every file the library names in the bucket: each song's, each artist's
 * picture, the sound vectors and the plays. A file not in this is one nothing
 * points at any more.
 */
const NAMED_KEYS = `
  SELECT audio_key AS key FROM cloud_songs
  UNION SELECT cover_key FROM cloud_songs WHERE cover_key IS NOT NULL
  UNION SELECT lyrics_key FROM cloud_songs WHERE lyrics_key IS NOT NULL
  UNION SELECT motion_key FROM cloud_songs WHERE motion_key IS NOT NULL
  UNION SELECT banner_key FROM cloud_artists
  UNION SELECT portrait_key FROM cloud_artists
  UNION SELECT key FROM cloud_sound
  UNION SELECT key FROM cloud_sound_map
  UNION SELECT key FROM cloud_plays
  UNION SELECT key FROM cloud_cover_packs`

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
  /** As the row says: what the words' signature falls back to when no file is here. */
  readonly lyricsKind: string
}

/**
 * Signed in through the doorman: a session for your Google account, which the
 * doorman exchanges for access to the bucket that belongs to it. No bucket
 * key is held here in this mode. Read back like the connection: a corrupt row
 * reads as signed out.
 */
const DoormanSessionSchema = z.object({
  /** The doorman it was issued by; a session means nothing to any other. */
  url: z.string(),
  token: z.string(),
  email: z.string(),
  name: z.string().nullable().catch(null),
  picture: z.string().nullable().catch(null),
  /**
   * The bucket the doorman last said belongs to the account, so a restart
   * can carry on publishing before the doorman has been asked again.
   */
  storage: DoormanStorageSchema.nullable().catch(null),
})
export type DoormanSession = Readonly<z.infer<typeof DoormanSessionSchema>>

/** Which bucket and folder the upload bookkeeping describes. */
interface CloudTarget {
  readonly endpoint: string
  readonly bucket: string
  readonly prefix: string
}

/**
 * One bucket and folder, however it was spelt: a folder standing in for the
 * bucket by its resolved path (a trailing slash or a `..` is the same folder),
 * an endpoint without case or a trailing slash, a prefix without slashes at
 * either end. A difference in spelling alone used to read as another bucket,
 * and forgot every upload.
 */
function targetFingerprint(target: CloudTarget): string {
  const folder = target.endpoint === 'file://'
  return JSON.stringify([
    folder ? target.endpoint : target.endpoint.trim().replace(/\/+$/, '').toLowerCase(),
    folder ? path.resolve(target.bucket) : target.bucket.trim(),
    target.prefix.trim().replace(/^\/+|\/+$/g, ''),
  ])
}

/** A fingerprint as stored, in today's spelling; one that will not read matches nothing. */
function storedFingerprint(value: string): string | null {
  try {
    const [endpoint, bucket, prefix] = JSON.parse(value) as unknown[]
    if (typeof endpoint !== 'string' || typeof bucket !== 'string' || typeof prefix !== 'string') {
      return null
    }
    return targetFingerprint({ endpoint, bucket, prefix })
  } catch {
    return null
  }
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
  lyrics_kind: string
}

const SONG_FILE_SELECT =
  'SELECT id, uid, title, path, mime, size_bytes, mtime_ms, has_art, art_rev, lyrics_kind FROM songs'

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
    lyricsKind: row.lyrics_kind,
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
  lyrics_sig: string
  motion_key: string | null
  motion_sig: string
  uploaded_at: string
}

export class CloudRepository {
  readonly #db: Db
  readonly #getSecret
  readonly #setSecret
  readonly #deleteSecret
  readonly #songFiles
  readonly #songFile
  readonly #states
  readonly #state
  readonly #saveState
  readonly #hasFile
  readonly #recordFile
  readonly #trashSong
  readonly #trashKey
  readonly #trashUnnamedCovers
  readonly #unnamedFiles
  readonly #unplacedSizes
  readonly #artists
  readonly #artist
  readonly #saveArtist
  readonly #dropArtist
  readonly #sound
  readonly #saveSound
  readonly #dropSound
  readonly #soundMap
  readonly #saveSoundMap
  readonly #dropSoundMap
  readonly #plays
  readonly #playsOf
  readonly #savePlays
  readonly #dropPlays
  readonly #coverPacks
  readonly #saveCoverPack
  readonly #dropCoverPack
  readonly #trashedKeys
  readonly #forgetFile
  readonly #rememberRemoved
  readonly #wasRemoved
  readonly #wasPlaylistRemoved
  readonly #untrash
  readonly #songWithAudio
  readonly #unsentOfSize
  readonly #totals
  readonly #tagUids
  readonly #playlistUids

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
    this.#state = db.prepare<[number], CloudSongRow>('SELECT * FROM cloud_songs WHERE song_id = ?')
    this.#saveState = db.prepare(`
      INSERT INTO cloud_songs (
        song_id, audio_key, audio_size, audio_sig, cover_key, cover_size, cover_sig,
        lyrics_key, lyrics_size, lyrics_kind, lyrics_sig,
        motion_key, motion_sig, uploaded_at
      ) VALUES (
        @songId, @audioKey, @audioSize, @audioSig, @coverKey, @coverSize, @coverSig,
        @lyricsKey, @lyricsSize, @lyricsKind, @lyricsSig,
        @motionKey, @motionSig, datetime('now')
      )
      ON CONFLICT (song_id) DO UPDATE SET
        audio_key = excluded.audio_key, audio_size = excluded.audio_size,
        audio_sig = excluded.audio_sig, cover_key = excluded.cover_key,
        cover_size = excluded.cover_size, cover_sig = excluded.cover_sig,
        lyrics_key = excluded.lyrics_key, lyrics_size = excluded.lyrics_size,
        lyrics_kind = excluded.lyrics_kind, lyrics_sig = excluded.lyrics_sig,
        motion_key = excluded.motion_key,
        motion_sig = excluded.motion_sig, uploaded_at = excluded.uploaded_at
    `)
    this.#hasFile = db.prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM cloud_files WHERE key = ?',
    )
    // `uploaded_at` is when this server first knew the file was there, and stays so.
    this.#recordFile = db.prepare<[string, number, string]>(`
      INSERT INTO cloud_files (key, size, uploaded_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET size = excluded.size
    `)

    // Every file of one song, into the trash, with the size the bucket listed.
    this.#trashSong = db.prepare(`
      INSERT INTO cloud_trash (key, size)
      SELECT k.key, COALESCE(f.size, 0)
        FROM (
          SELECT audio_key AS key FROM cloud_songs WHERE song_id = @songId
          UNION SELECT cover_key FROM cloud_songs WHERE song_id = @songId
          UNION SELECT lyrics_key FROM cloud_songs WHERE song_id = @songId
          UNION SELECT motion_key FROM cloud_songs WHERE song_id = @songId
        ) k
        LEFT JOIN cloud_files f ON f.key = k.key
       WHERE k.key IS NOT NULL
      ON CONFLICT (key) DO NOTHING
    `)
    // One file, with the size the bucket listed for it.
    this.#trashKey = db.prepare<[{ key: string }]>(`
      INSERT INTO cloud_trash (key, size)
      SELECT @key, COALESCE((SELECT size FROM cloud_files WHERE key = @key), 0)
       WHERE true
      ON CONFLICT (key) DO NOTHING
    `)
    this.#trashUnnamedCovers = db.prepare(`
      INSERT INTO cloud_trash (key, size)
      SELECT key, size FROM cloud_files
       WHERE key LIKE 'covers/%' AND key NOT IN (${NAMED_KEYS})
      ON CONFLICT (key) DO NOTHING
    `)
    this.#unnamedFiles = db.prepare<[string], { key: string; size: number }>(`
      SELECT key, size FROM cloud_files
       WHERE (key LIKE 'audio/%' OR key LIKE 'lyrics/%')
         AND uploaded_at <= ?
         AND key NOT IN (${NAMED_KEYS})
         AND key NOT IN (SELECT key FROM cloud_trash)
       ORDER BY key
    `)
    this.#unplacedSizes = db.prepare<[], { size: number }>(`
      SELECT DISTINCT s.size_bytes AS size FROM songs s
        LEFT JOIN cloud_songs c ON c.song_id = s.id
       WHERE c.song_id IS NULL
    `)
    this.#trashedKeys = db.prepare<[], { key: string }>(`
      SELECT key FROM cloud_trash WHERE key NOT IN (${NAMED_KEYS}) ORDER BY key
    `)
    this.#artists = db.prepare<[], CloudArtistRow>(
      'SELECT * FROM cloud_artists ORDER BY artist_key',
    )
    this.#artist = db.prepare<[string], CloudArtistRow>(
      'SELECT * FROM cloud_artists WHERE artist_key = ?',
    )
    this.#saveArtist = db.prepare(`
      INSERT INTO cloud_artists (artist_key, banner_key, banner_size, portrait_key, portrait_size, sig)
      VALUES (@artist, @bannerKey, @bannerSize, @portraitKey, @portraitSize, @sig)
      ON CONFLICT (artist_key) DO UPDATE SET
        banner_key = excluded.banner_key, banner_size = excluded.banner_size,
        portrait_key = excluded.portrait_key, portrait_size = excluded.portrait_size,
        sig = excluded.sig
    `)
    this.#dropArtist = db.prepare('DELETE FROM cloud_artists WHERE artist_key = ?')
    this.#sound = db.prepare<[], CloudSoundRow>('SELECT * FROM cloud_sound WHERE id = 1')
    this.#saveSound = db.prepare(`
      INSERT INTO cloud_sound (id, model, key, size, sig, uploaded_at)
      VALUES (1, @model, @key, @size, @sig, @uploadedAt)
      ON CONFLICT (id) DO UPDATE SET
        model = excluded.model, key = excluded.key, size = excluded.size,
        sig = excluded.sig, uploaded_at = excluded.uploaded_at
    `)
    this.#dropSound = db.prepare('DELETE FROM cloud_sound')
    this.#soundMap = db.prepare<[], CloudSoundMapState>(
      'SELECT key, size FROM cloud_sound_map WHERE id = 1',
    )
    this.#saveSoundMap = db.prepare(`
      INSERT INTO cloud_sound_map (id, key, size) VALUES (1, @key, @size)
      ON CONFLICT (id) DO UPDATE SET key = excluded.key, size = excluded.size
    `)
    this.#dropSoundMap = db.prepare('DELETE FROM cloud_sound_map')
    this.#plays = db.prepare<[], CloudPlaysRow>('SELECT * FROM cloud_plays ORDER BY month')
    this.#playsOf = db.prepare<[string], CloudPlaysRow>('SELECT * FROM cloud_plays WHERE month = ?')
    this.#savePlays = db.prepare(`
      INSERT INTO cloud_plays (month, key, size, count, sig, uploaded_at)
      VALUES (@month, @key, @size, @count, @sig, @uploadedAt)
      ON CONFLICT (month) DO UPDATE SET
        key = excluded.key, size = excluded.size, count = excluded.count,
        sig = excluded.sig, uploaded_at = excluded.uploaded_at
    `)
    this.#dropPlays = db.prepare('DELETE FROM cloud_plays WHERE month = ?')
    this.#coverPacks = db.prepare<[], CloudCoverPackRow>(
      'SELECT * FROM cloud_cover_packs ORDER BY rowid',
    )
    this.#saveCoverPack = db.prepare(`
      INSERT INTO cloud_cover_packs (key, size, covers) VALUES (@key, @size, @covers)
      ON CONFLICT (key) DO UPDATE SET size = excluded.size, covers = excluded.covers
    `)
    this.#dropCoverPack = db.prepare('DELETE FROM cloud_cover_packs WHERE key = ?')
    this.#forgetFile = db.prepare('DELETE FROM cloud_files WHERE key = ?')
    this.#rememberRemoved = db.prepare(
      'INSERT OR IGNORE INTO removed_songs (uid) SELECT uid FROM songs WHERE id = ?',
    )
    this.#wasRemoved = db.prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM removed_songs WHERE uid = ?',
    )
    this.#wasPlaylistRemoved = db.prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM removed_playlists WHERE uid = ?',
    )
    this.#untrash = db.prepare('DELETE FROM cloud_trash WHERE key = ?')
    this.#songWithAudio = db.prepare<[string], { id: number }>(
      `SELECT s.id FROM cloud_songs c JOIN songs s ON s.id = c.song_id
        WHERE c.audio_key = ? ORDER BY s.id ASC LIMIT 1`,
    )
    this.#unsentOfSize = db.prepare<[number], { id: number; path: string }>(
      `SELECT s.id, s.path FROM songs s LEFT JOIN cloud_songs c ON c.song_id = s.id
        WHERE c.song_id IS NULL AND s.size_bytes = ? ORDER BY s.id`,
    )
    this.#totals = db.prepare<[], { songs: number; in_cloud: number; bytes: number | null }>(
      `SELECT
         (SELECT COUNT(*) FROM songs) AS songs,
         (SELECT COUNT(*) FROM cloud_songs c JOIN songs s ON s.id = c.song_id) AS in_cloud,
         (SELECT SUM(size) FROM cloud_files) AS bytes`,
    )
    this.#tagUids = db.prepare<[], { id: number; uid: string }>('SELECT id, uid FROM tags')
    this.#playlistUids = db.prepare<[], { id: number; uid: string }>(
      'SELECT id, uid FROM playlists',
    )
  }

  // --- The connection ------------------------------------------------------

  connection(): CloudConnection | null {
    const row = this.#getSecret.get(CONNECTION_SECRET)
    return row ? readSecret(CloudConnectionSchema, row.value) : null
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
    return row ? readSecret(DoormanSessionSchema, row.value) : null
  }

  /** Signed in through the doorman. It replaces a direct connection. */
  saveDoormanSession(session: DoormanSession): void {
    this.#db.transaction(() => {
      this.#deleteSecret.run(CONNECTION_SECRET)
      this.#setSecret.run(DOORMAN_SECRET, JSON.stringify(session))
    })()
  }

  /**
   * The bucket and folder uploads go to. Pointed somewhere else, everything
   * remembered about the previous one is forgotten, so the next pass uploads
   * the library to where it now belongs instead of assuming it is already
   * there. A new key, or a new sign-in, for the same bucket keeps it all.
   */
  adoptTarget(target: CloudTarget): void {
    const fingerprint = targetFingerprint(target)
    this.#db.transaction(() => {
      const before = this.#getSecret.get(TARGET_SECRET)?.value
      if (before !== undefined && storedFingerprint(before) === fingerprint) {
        // Written before spellings were tidied: kept in the tidy form from now on.
        if (before !== fingerprint) this.#setSecret.run(TARGET_SECRET, fingerprint)
        return
      }
      this.#forgetUploads()
      this.#setSecret.run(TARGET_SECRET, fingerprint)
    })()
  }

  /** Everything this server knows about one bucket: what it uploaded, and how far it read the logs. */
  #forgetUploads(): void {
    this.#db.exec(
      'DELETE FROM cloud_songs; DELETE FROM cloud_artists; DELETE FROM cloud_sound; DELETE FROM cloud_sound_map; DELETE FROM cloud_plays; DELETE FROM cloud_cover_packs; DELETE FROM cloud_files; DELETE FROM cloud_log_cursors; DELETE FROM cloud_trash; DELETE FROM removed_songs; DELETE FROM removed_playlists;',
    )
  }

  /**
   * This server's name in the bucket, made the first time it is asked for.
   *
   * The name starts from the platform, so every caller would otherwise have to
   * spell the same `darwin → mac` out; the id is written down once anyway, so
   * only the first call on a fresh database ever looks.
   */
  deviceId(): string {
    const existing = this.#getSecret.get(DEVICE_SECRET)?.value
    if (existing) return existing
    const id = newCloudDeviceId(process.platform === 'darwin' ? 'mac' : process.platform)
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
    for (const row of this.#states.all()) states.set(row.song_id, toState(row))
    return states
  }

  /** What is in the bucket for one song, or null before anything is. */
  state(songId: number): CloudSongState | null {
    const row = this.#state.get(songId)
    return row ? toState(row) : null
  }

  /**
   * Record what is in the bucket for one song. A file it named before and no
   * longer does — a cover made again, words edited — goes in the trash, to be
   * deleted once the snapshot that names the new one is up and nothing else
   * names the old: left there, every replaced file stayed in the bucket for
   * good, nameless.
   */
  saveState(state: Omit<CloudSongState, 'uploadedAt'>): void {
    this.#db.transaction(() => {
      const before = this.#state.get(state.songId)
      this.#saveState.run(state)
      if (!before) return
      this.#trashReplaced(
        [before.audio_key, before.cover_key, before.lyrics_key, before.motion_key],
        [state.audioKey, state.coverKey, state.lyricsKey, state.motionKey],
      )
    })()
  }

  /** Each key in `before` that is not one of `after`, into the trash. */
  #trashReplaced(before: readonly (string | null)[], after: readonly (string | null)[]): void {
    for (const key of before) {
      if (key !== null && !after.includes(key)) this.#trashKey.run({ key })
    }
  }

  // --- Artists' pictures -----------------------------------------------------

  artistStates(): Map<string, CloudArtistState> {
    return new Map(this.#artists.all().map(row => [row.artist_key, toArtistState(row)]))
  }

  /** Record an artist's picture in the bucket; a picture it replaces goes in the trash. */
  saveArtist(state: CloudArtistState): void {
    this.#db.transaction(() => {
      const before = this.#artist.get(state.artist)
      this.#saveArtist.run(state)
      if (!before) return
      this.#trashReplaced(
        [before.banner_key, before.portrait_key],
        [state.bannerKey, state.portraitKey],
      )
    })()
  }

  /** An artist the library no longer has, or no longer has a picture of: theirs goes in the trash. */
  dropArtist(artist: string): void {
    this.#db.transaction(() => {
      const before = this.#artist.get(artist)
      if (!before) return
      this.#dropArtist.run(artist)
      this.#trashReplaced([before.banner_key, before.portrait_key], [])
    })()
  }

  // --- Sound vectors ---------------------------------------------------------

  soundState(): CloudSoundState | null {
    const row = this.#sound.get()
    return row
      ? {
          model: row.model,
          key: row.key,
          size: row.size,
          sig: row.sig,
          uploadedAt: row.uploaded_at,
        }
      : null
  }

  /** Record the sound vectors' file in the bucket; the one it replaces goes in the trash. */
  saveSound(state: CloudSoundState): void {
    this.#db.transaction(() => {
      const before = this.#sound.get()
      this.#saveSound.run(state)
      if (before) this.#trashReplaced([before.key], [state.key])
    })()
  }

  /** No vectors left to keep: the file goes in the trash. */
  dropSound(): void {
    this.#db.transaction(() => {
      const before = this.#sound.get()
      if (!before) return
      this.#dropSound.run()
      this.#trashReplaced([before.key], [])
    })()
  }

  // --- The sound map --------------------------------------------------------

  soundMapState(): CloudSoundMapState | null {
    const row = this.#soundMap.get()
    return row ? { key: row.key, size: row.size } : null
  }

  /** Record the sound map's file in the bucket; the one it replaces goes in the trash. */
  saveSoundMap(state: CloudSoundMapState): void {
    this.#db.transaction(() => {
      const before = this.#soundMap.get()
      this.#saveSoundMap.run(state)
      if (before) this.#trashReplaced([before.key], [state.key])
    })()
  }

  /** No map to keep: the file goes in the trash. */
  dropSoundMap(): void {
    this.#db.transaction(() => {
      const before = this.#soundMap.get()
      if (!before) return
      this.#dropSoundMap.run()
      this.#trashReplaced([before.key], [])
    })()
  }

  // --- Cover packs -----------------------------------------------------------

  /** The packs of covers in the bucket (services/coverPacks.ts), in the order they were made. */
  coverPacks(): CloudCoverPack[] {
    return this.#coverPacks.all().map(row => ({
      key: row.key,
      size: row.size,
      covers: JSON.parse(row.covers) as [string, number][],
    }))
  }

  /**
   * The packs the bucket now has, all of them: one not among them goes in the
   * trash, and goes from the bucket once the snapshot that no longer names it
   * is up.
   */
  saveCoverPacks(packs: readonly CloudCoverPack[]): void {
    this.#db.transaction(() => {
      const keep = new Set(packs.map(pack => pack.key))
      for (const before of this.#coverPacks.all()) {
        if (keep.has(before.key)) continue
        this.#dropCoverPack.run(before.key)
        this.#trashKey.run({ key: before.key })
      }
      for (const pack of packs) {
        this.#saveCoverPack.run({
          key: pack.key,
          size: pack.size,
          covers: JSON.stringify(pack.covers),
        })
      }
    })()
  }

  // --- Plays -----------------------------------------------------------------

  /** Every month of plays in the bucket, oldest first. */
  playsStates(): CloudPlaysState[] {
    return this.#plays.all().map(row => ({
      month: row.month,
      key: row.key,
      size: row.size,
      count: row.count,
      sig: row.sig,
      uploadedAt: row.uploaded_at,
    }))
  }

  /** Record a month's file in the bucket; the one it replaces goes in the trash. */
  savePlays(state: CloudPlaysState): void {
    this.#db.transaction(() => {
      const before = this.#playsOf.get(state.month)
      this.#savePlays.run(state)
      if (before) this.#trashReplaced([before.key], [state.key])
    })()
  }

  /** A month with no plays left (its songs all removed): its file goes in the trash. */
  dropPlays(month: string): void {
    this.#db.transaction(() => {
      const before = this.#playsOf.get(month)
      if (!before) return
      this.#dropPlays.run(month)
      this.#trashReplaced([before.key], [])
    })()
  }

  // --- The trash -------------------------------------------------------------

  /**
   * Put a song's bucket files in the trash, before its row goes, and remember
   * the song's uid until the snapshot without it is up.
   *
   * Nothing is deleted from the bucket here: the snapshot that still names the
   * song is the one every device is reading, and its files have to outlive it.
   * The cloud pass deletes what is in the trash once the next snapshot is up,
   * and only what no other song points at — two songs can share a cover. The
   * uid is what keeps adoption from taking the song back on from that same
   * snapshot in the meantime (services/cloudAdopt.ts).
   */
  trashSong(songId: number): void {
    this.#db.transaction(() => {
      this.#rememberRemoved.run(songId)
      this.#trashSong.run({ songId })
    })()
  }

  /** Whether this song was removed here and the bucket has not been told yet. */
  wasRemoved(uid: string): boolean {
    return (this.#wasRemoved.get(uid)?.n ?? 0) > 0
  }

  /**
   * Whether this playlist was deleted here and the bucket has not been told
   * yet: every deletion is noted, by the database itself (migration 58).
   */
  wasPlaylistRemoved(uid: string): boolean {
    return (this.#wasPlaylistRemoved.get(uid)?.n ?? 0) > 0
  }

  /** The snapshot without the removed songs and playlists is up: nothing can take them back on now. */
  forgetRemoved(): void {
    this.#db.exec('DELETE FROM removed_songs; DELETE FROM removed_playlists')
  }

  /**
   * Every cover in the bucket that nothing names, into the trash: replaced
   * before replacing put the old one there, or left by anything else. Only
   * `covers/`: a picture this server can always send again from its own copy
   * (services/covers.ts, artistBackdrops.ts), where a song's audio or words
   * that no row names may be the only copy there is of a song whose row was
   * reconciled away. Asked of the listing, so only once that is fresh.
   *
   * Returns how many went in.
   */
  trashUnnamedCovers(): number {
    return this.#trashUnnamedCovers.run().changes
  }

  /**
   * Audio and words in the bucket that nothing here names and nothing has put
   * in the trash, which this server has known of since `before` or longer:
   * what an import that failed halfway leaves behind, or a server that lost
   * its database. Asked of the listing, like `trashUnnamedCovers`, and only a
   * candidate: the sync also asks every snapshot in the bucket before any of
   * it goes in the trash (`#trashOrphans` in services/cloudSync.ts).
   */
  unnamedFiles(before: Date): { key: string; size: number }[] {
    return this.#unnamedFiles.all(toSqliteTime(before.getTime()))
  }

  /**
   * The sizes of the songs here that name no file in the bucket: one still
   * uploading, one the bucket had no audio for when it was taken on, or one
   * whose audio the bucket lost. Audio of one of these sizes may be the song's
   * own, so the sync deletes no audio or words while such a file is unnamed.
   */
  unplacedSongSizes(): Set<number> {
    return new Set(this.#unplacedSizes.all().map(row => row.size))
  }

  /** These files into the trash, to go once the next snapshot is up and if nothing names them then. */
  trashKeys(keys: readonly string[]): void {
    this.#db.transaction(() => {
      for (const key of keys) this.#trashKey.run({ key })
    })()
  }

  /** Trashed files nothing names any more: what the pass may delete. */
  trashedKeys(): string[] {
    return this.#trashedKeys.all().map(row => row.key)
  }

  /** The bucket no longer has this file: out of the trash and the listing both. */
  forgetFile(key: string): void {
    this.#db.transaction(() => {
      this.#untrash.run(key)
      this.#forgetFile.run(key)
    })()
  }

  /**
   * The song here whose audio is this file in the bucket, or null.
   *
   * A bucket file is named by the hash of its bytes, so the same key is the
   * same audio whatever either side calls the song. The oldest row wins over a
   * newer one, since the newer is the likelier to be the accident.
   */
  songWithAudio(audioKey: string): number | null {
    return this.#songWithAudio.get(audioKey)?.id ?? null
  }

  /**
   * Songs that have never been uploaded, of exactly this size.
   *
   * A song's hash is only written down when it goes up, so a server signing in
   * for the first time knows none of its own. Size is what it does know, and
   * two different recordings of exactly the same length in bytes are rare
   * enough that hashing the few that match costs nothing. The caller reads
   * each file, and one that is not on this disk is simply not a match.
   */
  unsentSongsOfSize(sizeBytes: number): { id: number; path: string }[] {
    return this.#unsentOfSize.all(sizeBytes)
  }

  hasFile(key: string): boolean {
    return (this.#hasFile.get(key)?.n ?? 0) > 0
  }

  /** The bucket has this file, as of `at` if this server did not know of it before. */
  recordFile(key: string, size: number, at: Date = new Date()): void {
    this.#recordFile.run(key, size, toSqliteTime(at.getTime()))
  }

  /**
   * Line the bookkeeping up with what the bucket really holds, given every
   * file key it lists. A file this server thought it had uploaded but the bucket
   * has lost is forgotten. A song whose audio went is forgotten too, so the
   * next pass uploads it again from a copy here; one that lost only its cover,
   * words or motion curve keeps its place, with that part forgotten, so the
   * pass sends it again from what this server keeps — or publishes the song
   * without it. Forgetting the whole song there left it out of every snapshot
   * once its copy here had been let go, with its audio in the bucket named by
   * nothing. Files the bucket has that were not known are remembered, as of
   * `at`, which saves asking about them one at a time later.
   *
   * Returns how many songs will be sent again.
   */
  reconcileFiles(present: ReadonlyMap<string, number>, at: Date = new Date()): number {
    return this.#db.transaction(() => {
      const known = this.#db.prepare<[], { key: string }>('SELECT key FROM cloud_files').all()
      const drop = this.#db.prepare('DELETE FROM cloud_files WHERE key = ?')
      for (const { key } of known) if (!present.has(key)) drop.run(key)
      const seen = toSqliteTime(at.getTime())
      for (const [key, size] of present) this.#recordFile.run(key, size, seen)

      const gone = (column: string): string =>
        `(${column} IS NOT NULL AND ${column} NOT IN (SELECT key FROM cloud_files))`
      const again = this.#db
        .prepare(
          `SELECT COUNT(*) AS n FROM cloud_songs
            WHERE ${gone('audio_key')} OR ${gone('cover_key')} OR ${gone('lyrics_key')}
               OR ${gone('motion_key')}`,
        )
        .get() as { n: number }
      this.#db.exec(
        `DELETE FROM cloud_songs WHERE ${gone('audio_key')};
         UPDATE cloud_songs SET cover_key = NULL, cover_size = NULL, cover_sig = ''
          WHERE ${gone('cover_key')};
         UPDATE cloud_songs
            SET lyrics_key = NULL, lyrics_size = NULL, lyrics_kind = NULL, lyrics_sig = ''
          WHERE ${gone('lyrics_key')};
         UPDATE cloud_songs SET motion_key = NULL, motion_sig = '' WHERE ${gone('motion_key')}`,
      )
      // An artist whose picture went is sent again too, and so are the sound
      // vectors, a month of plays and a pack of covers; they are not counted
      // as songs.
      this.#db.exec(
        `DELETE FROM cloud_artists
          WHERE banner_key NOT IN (SELECT key FROM cloud_files)
             OR portrait_key NOT IN (SELECT key FROM cloud_files);
         DELETE FROM cloud_sound WHERE key NOT IN (SELECT key FROM cloud_files);
         DELETE FROM cloud_sound_map WHERE key NOT IN (SELECT key FROM cloud_files);
         DELETE FROM cloud_plays WHERE key NOT IN (SELECT key FROM cloud_files);
         DELETE FROM cloud_cover_packs WHERE key NOT IN (SELECT key FROM cloud_files)`,
      )
      return again.n
    })()
  }

  /**
   * How many songs the library has, how many of them have their audio in the
   * bucket, and the size of everything in the bucket this server knows of.
   */
  totals(): { songs: number; songsInCloud: number; bytes: number } {
    const row = this.#totals.get()
    return { songs: row?.songs ?? 0, songsInCloud: row?.in_cloud ?? 0, bytes: row?.bytes ?? 0 }
  }

  tagUids(): Map<number, string> {
    return new Map(this.#tagUids.all().map(row => [row.id, row.uid]))
  }

  playlistUids(): Map<number, string> {
    return new Map(this.#playlistUids.all().map(row => [row.id, row.uid]))
  }
}

function toArtistState(row: CloudArtistRow): CloudArtistState {
  return {
    artist: row.artist_key,
    bannerKey: row.banner_key,
    bannerSize: row.banner_size,
    portraitKey: row.portrait_key,
    portraitSize: row.portrait_size,
    sig: row.sig,
  }
}

function toState(row: CloudSongRow): CloudSongState {
  return {
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
    lyricsSig: row.lyrics_sig,
    motionKey: row.motion_key,
    motionSig: row.motion_sig,
    uploadedAt: row.uploaded_at,
  }
}

/** A stored JSON secret through its schema; anything else reads as absent. */
function readSecret<S extends z.ZodTypeAny>(schema: S, value: string): z.output<S> | null {
  let json: unknown
  try {
    json = JSON.parse(value)
  } catch {
    return null
  }
  const parsed = schema.safeParse(json)
  return parsed.success ? (parsed.data as z.output<S>) : null
}
