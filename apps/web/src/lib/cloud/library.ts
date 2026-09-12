import { createCloudLibrary } from '@selfmp3/cloud'
import { webPlatform } from './webPlatform.js'
import * as session from './session.js'

/**
 * The web app's copy of the library, which is `@selfmp3/cloud`'s with a
 * browser behind it (docs/SYNC.md).
 *
 * The rules — replaying a snapshot, the outbox and its sequence numbers, when
 * the bucket is worth asking again — are in the package, because the phone
 * needs exactly those. What is left here is the binding, and every caller goes
 * on importing the same names from the same place.
 */

const library = createCloudLibrary(webPlatform, session)

export const {
  loadCloudLibrary,
  markCloudLibraryStale,
  cloudLibraryVersion,
  recordChanges,
  currentSongs,
  pendingCloudChanges,
  flushCloudChanges,
  cloudPlaylistSongs,
  cloudLyrics,
  cloudManifest,
  forgetCloudLibrary,
} = library

export { FILES_KEY } from '@selfmp3/cloud'
