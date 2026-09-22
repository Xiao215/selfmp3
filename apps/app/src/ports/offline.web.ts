/**
 * The browser's audio cache: keeping, listing, sizing and removing songs.
 *
 * A song's stream URL, which is also its cache key, is injected wiring: the
 * same shape the engine port uses for `streamUrl`. `downloadStorage.web.ts`
 * is what dresses these up as the `DownloadStorage` port the queue wants.
 */

/**
 * Where a song is fetched from, which is also its cache key — the service
 * worker matches on the request URL, so the two cannot drift.
 *
 * Configured once at startup rather than passed to every call, matching
 * `configureClient` in packages/client. Unset is a wiring mistake, not a
 * default: guessing a path here would cache songs under a URL the service
 * worker never sees, and the failure would look like "offline does not work"
 * rather than like a missing call.
 */
let streamUrl: ((songId: number) => string) | null = null

export function configureAudioCache(options: { streamUrl: (songId: number) => string }): void {
  streamUrl = options.streamUrl
}

function streamUrlFor(songId: number): string {
  if (!streamUrl) {
    throw new Error(
      'configureAudioCache() has not been called; there is no stream URL to cache under',
    )
  }
  return streamUrl(songId)
}

/**
 * Offline audio storage.
 *
 * Audio lives in the Cache API rather than IndexedDB for one specific reason:
 * a cached `Response` can be served straight back to an `<audio>` element by
 * the service worker, including range requests, without ever loading the whole
 * file into memory. A 60 MB library would be painful to shuttle through JS
 * blobs; here the browser handles it natively.
 *
 * The cache name is versioned so a breaking change can invalidate everything
 * at once by bumping it.
 */

export const AUDIO_CACHE = 'selfmp3-audio-v1'

/**
 * How a download tells the service worker it wants the file itself, not the
 * copy already kept. The other half is `REFRESH_HEADER` in sw.ts, which has no
 * imports on purpose; the two have to agree.
 */
const REFRESH_HEADER = 'x-selfmp3-refresh'

/** Cache keys are the stream URLs themselves, so the SW can match on request. */
function audioCacheKey(songId: number): string {
  return streamUrlFor(songId)
}

/** The song id a cache key names, or null for anything else. */
function songIdOfKey(url: string): number | null {
  const match = /\/api\/stream\/(\d+)$/.exec(new URL(url).pathname)
  return match?.[1] ? Number(match[1]) : null
}

/*
 * The Cache API is there on the installed desktop app's `app://selfmp3` page,
 * but it stores only http and https requests: `cache.put` throws "Request
 * scheme 'app' is unsupported". So it counts only on a web page. The installed
 * app keeps songs as files through the shell instead.
 */
function cachesAvailable(): boolean {
  return (
    typeof caches !== 'undefined' &&
    typeof window !== 'undefined' &&
    /^https?:$/.test(window.location.protocol)
  )
}

/**
 * Whether this browser can keep songs at all. The Cache API only exists in a
 * secure context, so a phone on plain `http://192.168…` has none of this — and
 * it cannot store for the installed desktop app's own scheme either.
 */
export function offlineStorageAvailable(): boolean {
  return cachesAvailable()
}

/** Ids of every song currently held offline. */
export async function cachedSongIds(): Promise<Set<number>> {
  if (!cachesAvailable()) return new Set()
  try {
    const cache = await caches.open(AUDIO_CACHE)
    const keys = await cache.keys()
    const ids = new Set<number>()
    for (const request of keys) {
      const songId = songIdOfKey(request.url)
      if (songId !== null) ids.add(songId)
    }
    return ids
  } catch {
    return new Set()
  }
}

export async function isCached(songId: number): Promise<boolean> {
  if (!cachesAvailable()) return false
  try {
    const cache = await caches.open(AUDIO_CACHE)
    return (await cache.match(audioCacheKey(songId))) !== undefined
  } catch {
    return false
  }
}

/**
 * How much room each of these songs is taking, by id. A song this device does
 * not hold is left out, which is how a caller tells the two apart; one stored
 * without a length counts as nothing rather than as missing.
 */
export async function cachedBytes(ids: Iterable<number>): Promise<Map<number, number>> {
  const bytes = new Map<number, number>()
  if (!cachesAvailable()) return bytes
  try {
    const cache = await caches.open(AUDIO_CACHE)
    for (const songId of ids) {
      const response = await cache.match(audioCacheKey(songId))
      if (!response) continue
      const length = Number(response.headers.get('content-length') ?? Number.NaN)
      bytes.set(songId, Number.isFinite(length) ? length : 0)
    }
  } catch {
    // An unreadable cache is holding nothing, as far as a budget is concerned.
  }
  return bytes
}

/**
 * How far through a download is, from 0 to 1 — or null when the server did
 * not say how big the file is, and only "still going" can be shown.
 */
type DownloadFraction = number | null

/**
 * Download one song into the cache.
 *
 * `cache: 'reload'` bypasses the browser's HTTP cache, and `REFRESH_HEADER`
 * bypasses our own service worker, which sits in front of it and would
 * otherwise hand back the very copy this is trying to replace. Both are needed
 * for a re-download after a file changed on the server to fetch fresh bytes. The
 * response is only stored if it is a complete 200 — caching a partial 206
 * would poison the cache with a fragment that plays for four seconds and stops.
 *
 * With `onProgress`, the body is passed through a counter on its way into the
 * cache: the bytes still stream straight to disk rather than being held in
 * memory, and the row's ring fills as they actually arrive.
 */
export async function cacheSong(
  songId: number,
  signal?: AbortSignal,
  onProgress?: (fraction: DownloadFraction) => void,
): Promise<number> {
  if (!cachesAvailable()) throw new Error('offline storage is not available in this browser')

  const cache = await caches.open(AUDIO_CACHE)
  const url = audioCacheKey(songId)

  const response = await fetch(url, {
    cache: 'reload',
    headers: { [REFRESH_HEADER]: '1' },
    ...(signal ? { signal } : {}),
  })

  if (!response.ok || response.status !== 200) {
    throw new Error(`could not download song ${songId} (${response.status})`)
  }

  const size = Number(response.headers.get('content-length') ?? 0)
  const total = Number.isFinite(size) && size > 0 ? size : null

  if (!onProgress || !response.body) {
    await cache.put(url, response.clone())
    return total ?? 0
  }

  onProgress(total === null ? null : 0)
  let received = 0
  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength
        onProgress(total === null ? null : Math.min(1, received / total))
        controller.enqueue(chunk)
      },
    }),
  )

  // Same status and headers — content-length included, which is what the
  // sync compares later to tell a stale copy from a current one.
  await cache.put(
    url,
    new Response(counted, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  )
  return total ?? received
}

export async function uncacheSong(songId: number): Promise<void> {
  if (!cachesAvailable()) return
  const cache = await caches.open(AUDIO_CACHE)
  await cache.delete(audioCacheKey(songId))
}

export async function clearAudioCache(): Promise<void> {
  if (!cachesAvailable()) return
  await caches.delete(AUDIO_CACHE)
}
