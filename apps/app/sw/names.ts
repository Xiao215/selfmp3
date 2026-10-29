/**
 * Names the service worker and the app have to agree on, in the one place
 * both import them from.
 *
 * Constants and nothing else: esbuild inlines them into sw.js, and the app's
 * own bundle takes them like any other module. Spelled out twice, the two
 * halves drift — a worker that does not know the cloud files cache is the
 * app's sweeps it away on every deploy. What the server or the replica has to
 * agree on too — the refresh header, the session's storage key — is in
 * packages/shared's `@selfmp3/shared/wire` instead.
 */

/**
 * Covers, the worker's own, and the pictures a tab unpacks from the bucket's
 * packs of covers (src/offline/covers.web.ts), under the `api/bucket/<key>`
 * address the worker answers an artist's picture at.
 */
export const API_CACHE = 'selfmp3-api-v2'

/** Songs kept on this device (src/ports/offline.web.ts), answered by the worker. */
export const AUDIO_CACHE = 'selfmp3-audio-v1'

/**
 * The last few cloud songs the worker downloaded whole to play them (sw.ts,
 * `playFromBucket`): the worker's own, and let go of at sign-out.
 */
export const PLAYED_CACHE = 'selfmp3-played-v1'

/** A cloud library's lyrics, romaji and motion, kept by the tab (src/ports/cloudPlatform.web.ts). */
export const CLOUD_FILES_CACHE = 'selfmp3-cloud-files-v1'

/**
 * What the page and the worker say to each other with `postMessage`: the
 * worker telling every page the bucket refused for the day, and that it kept
 * another played song (`PLAYED_CACHE` changed); a page asking the worker to
 * take it over after a hard reload, and to ask the bucket again before its
 * hold is up (the person pressed Try again).
 */
export const SW_MESSAGE = {
  bucketCapped: 'BUCKET_CAPPED',
  played: 'PLAYED',
  claim: 'CLAIM',
  release: 'RELEASE',
} as const

/** Where the worker keeps a played song, under its scope: `played/<bucket key>`. */
export const PLAYED_PREFIX = 'played/'

/**
 * The IndexedDB database the page keeps small things in (src/ports/idbStore.web.ts)
 * and the worker reads the doorman session and each song's files from. Both
 * open it with the same version and the same upgrade, whoever gets there first.
 */
export const DB_NAME = 'selfmp3'
export const DB_VERSION = 1
export const DB_STORE = 'kv'
