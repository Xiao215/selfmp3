import {
  LibrarySchema,
  LyricsResponseSchema,
  MotionSchema,
  PlaylistSongsSchema,
  type Library,
} from '@selfmp3/shared'

import { recordStore } from './recordStore'
import { createSchemaCache } from './schemaCache'

/**
 * What this device keeps of the server's answers, for when it cannot be asked.
 * Each is written after every successful fetch (`api/client.ts`) and read only
 * when a fetch fails; the rules are `schemaCache.ts`.
 */

/**
 * Each song's words. A song kept for the plane wants its lyrics on the plane
 * too: also written as a song's download runs (`ports/downloadTransfer.ts`)
 * and by the catch-up pass (`useKeepAlongside`).
 */
export const lyricsCache = createSchemaCache(recordStore('lyrics'), LyricsResponseSchema)

/**
 * Each song's motion curve, about 13 KB for four minutes: what Now Playing's
 * visuals follow where nothing can listen to the music live, so a song kept
 * for the plane has its visuals moving with it there too.
 */
export const motionCache = createSchemaCache(recordStore('motion'), MotionSchema)

/**
 * Each playlist's last known members. The library names every playlist and
 * says how long it is, but which songs are in one is a request of its own:
 * without a copy, a device holding every song could not open a playlist while
 * its server was away — it knew "5 songs · 19 min" and could not name one.
 */
export const playlistCache = createSchemaCache(recordStore('playlists'), PlaylistSongsSchema)

const libraries = createSchemaCache(recordStore('library'), LibrarySchema)
const SNAPSHOT = 'snapshot'

/**
 * The last library answer. `GET /api/library` is the whole library in one
 * response, so this is one record and the app opens with a full, browsable
 * library on a plane. Written when an answer's version moves, otherwise at
 * most every few minutes (`librarySnapshotWrites.ts` in packages/client), and
 * read once at launch.
 */
export const libraryCache = {
  read: (): Promise<Library | null> => libraries.read(SNAPSHOT),
  write: (library: Library): void => libraries.write(SNAPSHOT, library),
  clear: (): Promise<void> => libraries.clear(),
}
