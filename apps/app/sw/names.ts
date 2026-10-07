/**
 * Names the service worker and the app have to agree on, in the one place
 * both import them from.
 *
 * Constants and nothing else: esbuild inlines them into sw.js, and the app's
 * own bundle takes them like any other module. Spelled out twice, the two
 * halves drifted once — the worker did not know the cloud files cache was the
 * app's, and swept it away on every deploy.
 */

/** Songs kept on this device (src/ports/offline.web.ts), answered by the worker. */
export const AUDIO_CACHE = 'selfmp3-audio-v1'

/** A cloud library's lyrics, romaji and motion, kept by the tab (src/ports/cloudPlatform.web.ts). */
export const CLOUD_FILES_CACHE = 'selfmp3-cloud-files-v1'

/** How a download says it wants the file itself, not the copy already kept. */
export const REFRESH_HEADER = 'x-selfmp3-refresh'
