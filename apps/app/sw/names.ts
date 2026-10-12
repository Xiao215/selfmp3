/**
 * Names the service worker and the app have to agree on, in the one place
 * both import them from.
 *
 * Constants and nothing else: esbuild inlines them into sw.js, and the app's
 * own bundle takes them like any other module. Spelled out twice, the two
 * halves drift — a worker that does not know the cloud files cache is the
 * app's sweeps it away on every deploy.
 */

/** Songs kept on this device (src/ports/offline.web.ts), answered by the worker. */
export const AUDIO_CACHE = 'selfmp3-audio-v1'

/**
 * The last few cloud songs the worker downloaded whole to play them (sw.ts,
 * `playFromBucket`): the worker's own, and let go of at sign-out.
 */
export const PLAYED_CACHE = 'selfmp3-played-v1'

/** A cloud library's lyrics, romaji and motion, kept by the tab (src/ports/cloudPlatform.web.ts). */
export const CLOUD_FILES_CACHE = 'selfmp3-cloud-files-v1'

/** How a download says it wants the file itself, not the copy already kept. */
export const REFRESH_HEADER = 'x-selfmp3-refresh'

/**
 * The IndexedDB database the page keeps small things in (src/ports/idbStore.web.ts)
 * and the worker reads the doorman session and each song's files from. Both
 * open it with the same version and the same upgrade, whoever gets there first.
 */
export const DB_NAME = 'selfmp3'
export const DB_VERSION = 1
export const DB_STORE = 'kv'
