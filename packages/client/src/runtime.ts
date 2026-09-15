import type { Api } from './api/api.js'
import type {
  LibrarySnapshotStore,
  LyricsSnapshotStore,
  MotionSnapshotStore,
  PlaylistSnapshotStore,
} from './platform.js'

/**
 * The one client this app is using, and where it keeps its offline copy.
 *
 * Held at module scope rather than passed through a React context, which is a
 * deliberate trade. Both apps already kept exactly one `api` as a module export
 * and imported it directly, so this is where it already lived; keeping it there
 * is what let the 27 query hooks move across verbatim instead of each growing a
 * `useClient()` line, and 27 hand edits is 27 chances to change one.
 *
 * It also means the download queue and the playback service can make requests,
 * which they do today from outside the component tree where there is no context
 * to read.
 *
 * What it costs: two clients in one process is not possible, and a test has to
 * configure and reset rather than wrap. Neither has come up. If the universal
 * app ever needs two — a preview of another server beside the real one — this
 * becomes a context and the hooks each grow that line then, with a reason.
 */
export interface ClientRuntime {
  readonly api: Api
  /** Absent where an app has no offline story; the library query then just fails. */
  readonly librarySnapshot?: LibrarySnapshotStore
  /** Each playlist's last known members, for the same reason. */
  readonly playlistSnapshot?: PlaylistSnapshotStore
  /** Each song's last known words, so a kept song can be sung along to on a plane. */
  readonly lyricsSnapshot?: LyricsSnapshotStore
  /** Each song's last known motion curve, so a kept song's visuals still follow it offline. */
  readonly motionSnapshot?: MotionSnapshotStore
}

let configured: ClientRuntime | null = null

/** Called once, as early as the app can manage. */
export function configureClient(runtime: ClientRuntime): void {
  configured = runtime
}

/**
 * The configured client.
 *
 * Throws rather than returning null: reaching a query hook before the app has
 * configured itself is a wiring mistake, and it should say so at the point it
 * happens rather than surface three screens later as a request that never ran.
 */
export function clientApi(): Api {
  if (!configured) {
    throw new Error('configureClient() has not been called; no API client is configured')
  }
  return configured.api
}

/** The offline copy of the library, or null where the app keeps none. */
export function librarySnapshot(): LibrarySnapshotStore | null {
  return configured?.librarySnapshot ?? null
}

/** The offline copies of playlists' members, or null where the app keeps none. */
export function playlistSnapshot(): PlaylistSnapshotStore | null {
  return configured?.playlistSnapshot ?? null
}

/** The offline copies of songs' words, or null where the app keeps none. */
export function lyricsSnapshot(): LyricsSnapshotStore | null {
  return configured?.lyricsSnapshot ?? null
}

/** The offline copies of songs' motion curves, or null where the app keeps none. */
export function motionSnapshot(): MotionSnapshotStore | null {
  return configured?.motionSnapshot ?? null
}
