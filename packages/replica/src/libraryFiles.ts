import {
  CLOUD_FILES_KEY,
  DOORMAN_ERROR,
  DOORMAN_PATHS,
  DoormanError,
  MotionSchema,
  artistKey,
  decodeSoundPack,
  messageOf,
  parseCloudWords,
  parseSoundMap,
  type CloudCoverPack,
  type CloudSnapshot,
  type MapPlace,
  type Motion,
  type RoomSong,
  type SoundMap,
  type SyncManifest,
} from '@selfmp3/shared'
import { PLAYLISTS_KEY } from './kept.js'
import type { CloudPlatform, CloudResponse } from './platform.js'
import { roomSongOf } from './roomSong.js'
import type { CloudSession, CloudSessionApi } from './session.js'
import type { ArtistPictureKeys, CloudLibrary, SongFiles } from './snapshotLibrary.js'

/**
 * What a device's copy of the library points at in the bucket (library.ts):
 * a song's words, its motion curve, its cover and its audio, the artists'
 * pictures, the sound vectors and the sound map, and what to keep for
 * downloads. Read from the library held in memory, or from what the copy
 * kept on the device while none is loaded; text files are read from the
 * bucket once and kept by their hash.
 */

/** A song's words and their romanized lines, as the server's lyrics answer carries them. */
interface CloudWords {
  readonly text: string
  readonly kind: 'plain' | 'synced'
  readonly romanized: string[] | null
}

/** Every picture the library names in the bucket. */
interface CloudPictures {
  readonly covers: ReadonlySet<string>
  readonly artists: readonly ArtistPictureKeys[]
  /** The same pictures, packed a few megabytes to a file, for filling a device from nothing. */
  readonly packs: readonly CloudCoverPack[]
}

/** How the library's songs sound, by audio key (shared soundVectors.ts). */
interface SoundVectors {
  readonly model: string
  readonly vectors: ReadonlyMap<string, Float32Array>
}

export interface LibraryFilesApi {
  cloudPlaylistSongs: (playlistId: number) => Promise<readonly number[]>
  /** Every playlist's songs, by playlist id, brought up to date once. */
  cloudAllPlaylistSongs: () => Promise<Readonly<Record<number, readonly number[]>>>
  cloudLyrics: (session: CloudSession | null, songId: number) => Promise<CloudWords | null>
  /** A song's motion curve, from this device if it has read it before, else the bucket; null when there is none. */
  cloudMotion: (session: CloudSession | null, songId: number) => Promise<Motion | null>
  /** A song's cover in the bucket (`covers/<sha256>.<ext>`), or null. */
  cloudCoverKey: (songId: number) => Promise<string | null>
  /**
   * The same, answered now from the library held in memory: undefined while
   * none is loaded yet, when only `cloudCoverKey` can say.
   */
  cloudCoverKeyNow: (songId: number) => string | null | undefined
  /**
   * An artist's picture in the bucket, by any spelling of their name, from the
   * library held in memory: null for an artist with none, undefined while no
   * library is loaded.
   */
  cloudArtistPictureNow: (name: string) => ArtistPictureKeys | null | undefined
  /**
   * Every picture the library names in the bucket — each song's cover, each
   * artist's picture — or null while none is loaded: what a device keeping
   * them may keep, and nothing else.
   */
  cloudPicturesNow: () => CloudPictures | null
  cloudManifest: (scope: 'library' | 'playlists') => SyncManifest
  /**
   * One of your songs as a listening room carries it (roomSong.ts), from the
   * library held in memory; null while none is loaded, or for a song a room
   * could not play.
   */
  cloudRoomSongNow: (songId: number) => RoomSong | null
  /**
   * A song's audio in the bucket (`audio/<sha256>.<ext>`), from the library
   * held in memory: what `cloudSoundVectors` names its sound by. Null for a
   * song it does not hold, undefined while none is loaded.
   */
  cloudAudioKeyNow: (songId: number) => string | null | undefined
  /**
   * Whether the bucket answers reads again, while they are refused for the
   * day: one byte of one song's audio, the cheapest read there is. The
   * library's own look only lists the bucket, which Backblaze caps apart, so it
   * cannot say (R2-M9). Asked while the hold stands; answered, the hold on
   * reads is let go, refused, held again (session.ts). False when it could not
   * ask: no library loaded, or none of its songs in the bucket.
   */
  askBucketRead: (session: CloudSession) => Promise<boolean>
  /**
   * How your library's songs sound (shared soundVectors.ts), by audio key,
   * from the pack the snapshot names; null before the server has heard any,
   * or with no library loaded. Read once per pack and kept in memory.
   */
  cloudSoundVectors: (session: CloudSession) => Promise<SoundVectors | null>
  /**
   * The sound map (docs/features/sound-map.md): each heard song's place, from
   * the file the snapshot names, kept on the device by its hash like the
   * words, so it is read from the bucket once a change.
   */
  cloudSoundMap: (session: CloudSession) => Promise<SoundMap>
}

/** What the files are read from: the copy library.ts keeps. */
interface LibraryCopy {
  /** The library held in memory, or null while none is loaded. */
  readonly held: () => CloudLibrary | null
  /** The snapshot it was replayed from, or null while none is loaded or the bucket has none. */
  readonly snapshot: () => CloudSnapshot | null
  /** The view held, with every change recorded since brought into it; null while none is loaded. */
  readonly current: () => Promise<CloudLibrary | null>
  /** The library, looking at the bucket when a look is due (`loadCloudLibrary`). */
  readonly load: (session: CloudSession) => Promise<CloudLibrary>
  /** Look at the bucket on the next load (`markCloudLibraryStale`). */
  readonly markStale: () => void
}

export function createLibraryFiles(
  platform: CloudPlatform,
  sessionApi: CloudSessionApi,
  { held, snapshot, current, load, markStale }: LibraryCopy,
): LibraryFilesApi {
  const warn = (message: string): void => platform.warn?.(message)

  /** Every playlist's songs, in order, from the library as this device has it — offline too. */
  async function cloudAllPlaylistSongs(): Promise<Readonly<Record<number, readonly number[]>>> {
    // Brought up to date first: plays can move a song into a Live playlist.
    return (
      (await current())?.playlistSongs ??
      ((await platform.store.read(PLAYLISTS_KEY)) as Record<number, number[]> | null) ??
      {}
    )
  }

  async function cloudPlaylistSongs(playlistId: number): Promise<readonly number[]> {
    return (await cloudAllPlaylistSongs())[playlistId] ?? []
  }

  async function filesOf(songId: number): Promise<SongFiles | null> {
    const files =
      held()?.files ??
      ((await platform.store.read(CLOUD_FILES_KEY)) as Record<number, SongFiles> | null)
    return files?.[songId] ?? null
  }

  /**
   * A song's lyrics and their romanized lines, the way the server's own lyrics
   * answer carries them: one file (`wordsKey`), from this device if it has
   * read it before, else the bucket.
   */
  async function cloudLyrics(
    session: CloudSession | null,
    songId: number,
  ): Promise<CloudWords | null> {
    const files = await filesOf(songId)
    if (!files?.lyrics || !files.lyricsKind) return null
    const json = await cloudText(session, files.lyrics)
    const words = json === null ? null : parseCloudWords(json)
    return words ? { text: words.text, kind: files.lyricsKind, romanized: words.romanized } : null
  }

  /**
   * A song's motion curve, the way the server's own motion answer carries it.
   * Read like the words — a text file named by its hash, kept once read — so a
   * song played once on a cloud library has its visuals on the plane too.
   */
  async function cloudMotion(session: CloudSession | null, songId: number): Promise<Motion | null> {
    const files = await filesOf(songId)
    if (!files?.motion) return null
    const json = await cloudText(session, files.motion)
    if (json === null) return null
    try {
      const parsed = MotionSchema.safeParse(JSON.parse(json))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  /**
   * A text file from the bucket, named by the hash of its own bytes, so a
   * cached copy is never stale. The cache is a convenience: one that fails is
   * a miss, never a failure. Anything thrown here reaches the screen as
   * "offline", and a device whose cache refused a write once said "reconnect"
   * while the words sat in hand.
   */
  async function cloudText(session: CloudSession | null, key: string): Promise<string | null> {
    const cached = await platform.textCache?.read(key).catch((error: unknown) => {
      warn(`the text cache could not be read: ${messageOf(error)}`)
      return null
    })
    if (cached !== null && cached !== undefined) return cached

    if (!session) throw new DoormanError(0, DOORMAN_ERROR.unauthorized, 'Not signed in.')
    const response = await sessionApi.doormanFetch(session, DOORMAN_PATHS.file(key))
    if (response.status === 404) return null
    const text = await bucketText(platform, response)
    await platform.textCache?.write(key, text).catch((error: unknown) => {
      warn(`the text cache could not be written: ${messageOf(error)}`)
    })
    return text
  }

  /**
   * Where a song's cover is in the bucket.
   *
   * The key rather than the bytes: artwork goes to a file and is handed to the
   * OS image loader as a path, and a base64 round trip through JavaScript for
   * every row in a list is not the way to get there.
   */
  async function cloudCoverKey(songId: number): Promise<string | null> {
    return (await filesOf(songId))?.cover ?? null
  }

  function cloudCoverKeyNow(songId: number): string | null | undefined {
    const files = held()?.files
    if (!files) return undefined
    return files[songId]?.cover ?? null
  }

  function cloudAudioKeyNow(songId: number): string | null | undefined {
    const files = held()?.files
    if (!files) return undefined
    return files[songId]?.audio ?? null
  }

  async function askBucketRead(session: CloudSession): Promise<boolean> {
    const files = held()?.files
    const audio = files ? Object.values(files).find(file => file.audio)?.audio : undefined
    if (!audio) return false
    // Through the hold, which stands until the answer: the session lets it go
    // or holds again, and the screens change only if that changes anything.
    await sessionApi
      .doormanFetch(session, DOORMAN_PATHS.file(audio), {
        headers: { range: 'bytes=0-0' },
        asking: true,
      })
      .catch(() => undefined)
    return true
  }

  function cloudArtistPictureNow(name: string): ArtistPictureKeys | null | undefined {
    const artists = held()?.artists
    if (!artists) return undefined
    return artists.get(artistKey(name)) ?? null
  }

  function cloudPicturesNow(): CloudPictures | null {
    const view = held()
    if (!view) return null
    const covers = new Set<string>()
    for (const files of Object.values(view.files)) if (files.cover) covers.add(files.cover)
    return {
      covers,
      artists: [...view.artists.values()],
      packs: snapshot()?.coverPacks ?? [],
    }
  }

  function cloudRoomSongNow(songId: number): RoomSong | null {
    const view = held()
    const files = view?.files[songId]
    const song = view?.byId.songs.get(songId)
    if (!view || !files || !song) return null
    return roomSongOf(song, files, view.uids.songs.get(songId) ?? null)
  }

  let soundRead: { key: string; pack: Promise<SoundVectors | null> } | null = null

  function cloudSoundVectors(session: CloudSession): Promise<SoundVectors | null> {
    const sound = snapshot()?.sound
    if (!sound) return Promise.resolve(null)
    if (soundRead?.key !== sound.key) {
      const pack = (async () => {
        const response = await sessionApi.doormanFetch(session, DOORMAN_PATHS.file(sound.key))
        if (!response.ok) return null
        return decodeSoundPack(new Uint8Array(await response.arrayBuffer()))
      })()
      // A failed read is tried again next time, not kept.
      pack.then(
        result => {
          if (result === null && soundRead?.pack === pack) soundRead = null
        },
        () => {
          if (soundRead?.pack === pack) soundRead = null
        },
      )
      soundRead = { key: sound.key, pack }
    }
    return soundRead.pack
  }

  let soundMapRead: { key: string; places: ReadonlyMap<string, MapPlace> } | null = null

  async function cloudSoundMap(session: CloudSession): Promise<SoundMap> {
    let view = await load(session)
    let places = await soundMapPlaces(session)
    if (places === 'gone') {
      // The copy kept from the last look names a map the server has since
      // replaced and deleted: a newer snapshot names the one in its place.
      markStale()
      view = await load(session)
      places = await soundMapPlaces(session)
    }
    const out: SoundMap['places'] = []
    if (places && places !== 'gone') {
      for (const song of view.library.songs) {
        const audio = view.files[song.id]?.audio
        const place = audio === undefined ? undefined : places.get(audio)
        if (place) out.push({ id: song.id, x: place.x, y: place.y })
      }
    }
    return { places: out }
  }

  /** The places in the map the copy names; null with none named or one this build cannot read. */
  async function soundMapPlaces(
    session: CloudSession,
  ): Promise<ReadonlyMap<string, MapPlace> | 'gone' | null> {
    const pointer = snapshot()?.soundMap
    if (!pointer) return null
    if (soundMapRead?.key === pointer.key) return soundMapRead.places
    const text = await cloudText(session, pointer.key)
    if (text === null) return 'gone'
    const places = parseSoundMap(text)
    if (places) soundMapRead = { key: pointer.key, places }
    return places
  }

  /** What this device should keep, for automatic downloads: every song, or those in playlists. */
  function cloudManifest(scope: 'library' | 'playlists'): SyncManifest {
    const view = held()
    if (!view) return { version: 0, songCount: 0, totalBytes: 0, entries: [] }
    const inPlaylists = new Set(Object.values(view.playlistSongs).flat())
    const entries = view.library.songs
      .filter(song => scope === 'library' || inPlaylists.has(song.id))
      .map(song => ({ id: song.id, sizeBytes: song.sizeBytes, etag: song.rev }))
    return {
      version: view.library.version,
      songCount: entries.length,
      totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
      entries,
    }
  }

  return {
    cloudPlaylistSongs,
    cloudAllPlaylistSongs,
    cloudLyrics,
    cloudMotion,
    cloudCoverKey,
    cloudCoverKeyNow,
    cloudArtistPictureNow,
    cloudPicturesNow,
    cloudManifest,
    cloudRoomSongNow,
    cloudAudioKeyNow,
    askBucketRead,
    cloudSoundVectors,
    cloudSoundMap,
  }
}

/**
 * A text file from the bucket. Snapshots are stored gzip-compressed; the
 * browser undoes that itself when the doorman passes the encoding on, and
 * here when it does not.
 */
export async function bucketText(
  platform: CloudPlatform,
  response: CloudResponse,
): Promise<string> {
  return platform.decodeText(new Uint8Array(await response.arrayBuffer()))
}
