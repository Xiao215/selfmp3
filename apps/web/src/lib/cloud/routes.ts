import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '@selfmp3/shared'
import {
  cloudLibraryVersion,
  cloudLyrics,
  cloudManifest,
  cloudPlaylistSongs,
  loadCloudLibrary,
} from './library.js'
import { DoormanError, doormanFetch, loadSession } from './session.js'

/**
 * The web app's stand-in for the Mac's API (docs/SYNC.md).
 *
 * Built for the web there is no `/api` to ask, so `request()` in api.ts sends
 * every call here instead. What the bucket can answer — the library, a
 * playlist's songs, lyrics, what to download — is answered from it through
 * the doorman; settings live on this device; everything else still needs the
 * Mac, and says so. Answers are the same JSON the Mac would send, and go
 * through the same schemas.
 */

/** A route that fails: status 0 reads as "offline" to the rest of the app. */
export class CloudRouteError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, message: string, code: string) {
    super(message)
    this.name = 'CloudRouteError'
    this.status = status
    this.code = code
  }
}

const SETTINGS_KEY = 'selfmp3.cloud.settings'

export async function cloudRequest(method: string, path: string, body: unknown): Promise<unknown> {
  const url = new URL(path, 'https://app.invalid')
  const route = `${method} ${url.pathname}`

  try {
    if (route === 'GET /api/settings') return loadSettings()
    if (route === 'PATCH /api/settings') return saveSettings(body)
    if (route === 'GET /api/health') return await health()

    const session = await loadSession()
    if (!session) throw new CloudRouteError(401, 'Sign in with Google first.', 'unauthorized')

    if (route === 'GET /api/library') return (await loadCloudLibrary(session)).library
    if (route === 'GET /api/library/version') return await cloudLibraryVersion(session)
    if (route === 'GET /api/library/manifest') {
      await loadCloudLibrary(session)
      return cloudManifest(url.searchParams.get('scope') === 'playlists' ? 'playlists' : 'library')
    }

    const playlist = /^GET \/api\/playlists\/(\d+)\/songs$/.exec(route)
    if (playlist?.[1]) {
      const playlistId = Number(playlist[1])
      return { playlistId, songIds: await cloudPlaylistSongs(playlistId) }
    }

    const lyrics = /^GET \/api\/songs\/(\d+)\/lyrics$/.exec(route)
    if (lyrics?.[1]) {
      const found = await cloudLyrics(session, Number(lyrics[1]))
      if (!found) throw new CloudRouteError(404, 'No lyrics for this song.', 'not_found')
      return { source: 'sidecar', kind: found.kind, text: found.text }
    }
  } catch (error) {
    if (error instanceof CloudRouteError) throw error
    if (error instanceof DoormanError) {
      throw new CloudRouteError(
        error.status,
        error.message,
        error.status === 0 ? 'offline' : error.code,
      )
    }
    throw error
  }

  throw new CloudRouteError(501, 'Not in the web app yet — this still needs your Mac.', 'needs-mac')
}

/** "Reachable" means the doorman answers: the web app's only server. */
async function health(): Promise<unknown> {
  const response = await doormanFetch(null, '/v1/health')
  if (!response.ok) throw new DoormanError(response.status, 'the doorman is not answering')
  return {
    ok: true,
    version: 'web',
    uptimeSeconds: 0,
    libraryPath: 'the cloud',
    storageDriver: 'cloud',
    songCount: 0,
  }
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const parsed = SettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      ...(raw ? JSON.parse(raw) : {}),
    })
    return parsed.success ? parsed.data : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Kept on this device: with no Mac to share them through, they are this device's own. */
function saveSettings(patch: unknown): Settings {
  const next = SettingsSchema.parse({ ...loadSettings(), ...(patch as object) })
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {
    // Private mode: the change holds until the page is closed.
  }
  return next
}
