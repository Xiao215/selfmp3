import {
  CloudSnapshotSchema,
  DoormanListSchema,
  SNAPSHOTS_FOLDER,
  newestSnapshotKey,
  type SyncManifest,
} from '@selfmp3/shared'
import { readStored, writeStored } from '../../offline/mirror.js'
import { appPath } from '../platform.js'
import { DoormanError, doormanFetch, type CloudSession } from './session.js'
import {
  NO_IDS,
  snapshotToLibrary,
  type CloudLibrary,
  type LocalIds,
  type SongFiles,
} from './snapshotLibrary.js'

/**
 * The library, read from the bucket through the doorman (docs/SYNC.md).
 *
 * The newest snapshot is the library. Reading it is one listing and one
 * download, and it is only downloaded again when a newer one appears. Where
 * each song's files are is kept in IndexedDB, for the service worker: it is
 * what fetches a song or a cover from the bucket when the player asks for one
 * this device does not have yet.
 */

const IDS_KEY = 'cloud-ids'
/** Read by the service worker (sw.ts) — keep the two in step. */
export const FILES_KEY = 'cloud-files'
const PLAYLISTS_KEY = 'cloud-playlist-songs'
const STATE_KEY = 'cloud-state'
/** Lyrics once read, so they are there on a plane. Named by their hash, they never go stale. */
const FILES_CACHE = 'selfmp3-cloud-files-v1'

let current: { readonly key: string; readonly view: CloudLibrary } | null = null

/** The newest snapshot's key, or null before the Mac has published one. */
async function newestSnapshot(session: CloudSession): Promise<string | null> {
  const keys: string[] = []
  let cursor: string | null = null
  do {
    const params = new URLSearchParams({ prefix: SNAPSHOTS_FOLDER })
    if (cursor) params.set('cursor', cursor)
    const response = await doormanFetch(session, `/v1/list?${params.toString()}`)
    const page = DoormanListSchema.parse(await response.json())
    keys.push(...page.objects.map(object => object.key))
    cursor = page.cursor
  } while (cursor)
  return newestSnapshotKey(keys)
}

export async function loadCloudLibrary(session: CloudSession): Promise<CloudLibrary> {
  const key = await newestSnapshot(session)
  if (current && current.key === key) return current.view

  const state = (await readStored(STATE_KEY)) as { key?: unknown; version?: unknown } | null
  const lastVersion = typeof state?.version === 'number' ? state.version : 0
  const version = state?.key === key ? lastVersion : lastVersion + 1
  const ids = asLocalIds(await readStored(IDS_KEY))

  if (!key) {
    const empty = snapshotToLibrary(
      {
        format: 1,
        writtenAt: new Date().toISOString(),
        writtenBy: 'none',
        upTo: {},
        songs: [],
        tags: [],
        playlists: [],
      },
      ids,
      version,
    )
    return empty
  }

  const response = await doormanFetch(session, `/v1/files/${key}`)
  if (response.status === 404) throw new DoormanError(404, 'The library snapshot went missing.')
  const snapshot = CloudSnapshotSchema.parse(JSON.parse(await readText(response)))
  const view = snapshotToLibrary(snapshot, ids, version)

  await writeStored(IDS_KEY, view.ids)
  await writeStored(FILES_KEY, view.files)
  await writeStored(PLAYLISTS_KEY, view.playlistSongs)
  await writeStored(STATE_KEY, { key, version })
  current = { key, view }
  return view
}

/**
 * Whether a newer snapshot is waiting: a version past the current one when
 * there is. The app polls this cheaply and fetches the library when it moves.
 */
export async function cloudLibraryVersion(
  session: CloudSession,
): Promise<{ version: number; songCount: number }> {
  const key = await newestSnapshot(session)
  const version = current?.view.library.version ?? 0
  const songCount = current?.view.library.songs.length ?? 0
  return { version: current && key === current.key ? version : version + 1, songCount }
}

/** A playlist's songs, in order, from the last library read — offline too. */
export async function cloudPlaylistSongs(playlistId: number): Promise<readonly number[]> {
  const stored =
    current?.view.playlistSongs ??
    ((await readStored(PLAYLISTS_KEY)) as Record<number, number[]> | null)
  return stored?.[playlistId] ?? []
}

async function filesOf(songId: number): Promise<SongFiles | null> {
  const files =
    current?.view.files ?? ((await readStored(FILES_KEY)) as Record<number, SongFiles> | null)
  return files?.[songId] ?? null
}

/** A song's lyrics, from this device if it has read them before, else the bucket. */
export async function cloudLyrics(
  session: CloudSession | null,
  songId: number,
): Promise<{ text: string; kind: 'plain' | 'synced' } | null> {
  const files = await filesOf(songId)
  if (!files?.lyrics || !files.lyricsKind) return null

  const cacheKey = appPath(`cloud-files/${files.lyrics}`)
  const cache = typeof caches === 'undefined' ? null : await caches.open(FILES_CACHE)
  const cached = await cache?.match(cacheKey)
  if (cached) return { text: await cached.text(), kind: files.lyricsKind }

  if (!session) throw new DoormanError(0, 'Not signed in.')
  const response = await doormanFetch(session, `/v1/files/${files.lyrics}`)
  if (response.status === 404) return null
  const text = await readText(response)
  await cache?.put(cacheKey, new Response(text, { headers: { 'Content-Type': 'text/plain' } }))
  return { text, kind: files.lyricsKind }
}

/** What this device should keep, for automatic downloads: every song, or those in playlists. */
export function cloudManifest(scope: 'library' | 'playlists'): SyncManifest {
  const view = current?.view
  if (!view) return { version: 0, songCount: 0, totalBytes: 0, entries: [] }
  const inPlaylists = new Set(Object.values(view.playlistSongs).flat())
  const entries = view.library.songs
    .filter(song => scope === 'library' || inPlaylists.has(song.id))
    .map(song => ({ id: song.id, sizeBytes: song.sizeBytes, etag: song.rev ?? '' }))
  return {
    version: view.library.version,
    songCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    entries,
  }
}

/** Forget everything read from the bucket — on signing out, or a different account. */
export async function forgetCloudLibrary(): Promise<void> {
  current = null
  for (const key of [IDS_KEY, FILES_KEY, PLAYLISTS_KEY, STATE_KEY]) {
    await writeStored(key, null).catch(() => undefined)
  }
  if (typeof caches !== 'undefined') await caches.delete(FILES_CACHE).catch(() => false)
}

/**
 * A text file from the bucket. Snapshots are stored gzip-compressed; the
 * browser undoes that itself when the doorman passes the encoding on, and
 * here when it does not.
 */
async function readText(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Response(stream).text()
  }
  return new TextDecoder().decode(bytes)
}

function asLocalIds(value: unknown): LocalIds {
  if (typeof value !== 'object' || value === null) return NO_IDS
  const ids = value as Partial<LocalIds>
  if (
    typeof ids.next !== 'number' ||
    typeof ids.songs !== 'object' ||
    typeof ids.tags !== 'object' ||
    typeof ids.playlists !== 'object'
  ) {
    return NO_IDS
  }
  return ids as LocalIds
}
