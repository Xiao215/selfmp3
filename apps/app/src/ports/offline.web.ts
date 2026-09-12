import type { SyncManifest } from '@selfmp3/shared'
import type { OfflineStore, SaveOptions, StorageUsage as PortStorageUsage } from '@selfmp3/client'

/**
 * The web half of the `OfflineStore` port.
 *
 * `apps/web/src/offline/audioCache.ts`, moved here per phase 3 of
 * docs/UNIVERSAL.md, with one change: the cache key no longer calls the web
 * app's `appPath`.
 *
 * That one import is worth a note, because it is the same module the spike had
 * to stub out — the only one in `apps/web` that reads Vite's `import.meta.env`,
 * which Metro cannot evaluate. It was used in exactly one place, to build a
 * stream URL, so it became injected wiring in the same shape the engine port
 * already uses for `streamUrl`. The stub the spike needed is now unnecessary
 * here for the same reason the engine's was: the tie to the web app was one
 * function, and naming it made it go away.
 *
 * Everything below the copy is the adapter onto the port. It is thin, which is
 * the finding: the port was derived from both apps' offline code, and the web
 * side needed no reshaping to meet it.
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
export function audioCacheKey(songId: number): string {
  return streamUrlFor(songId)
}

/** The song id a cache key names, or null for anything else. */
function songIdOfKey(url: string): number | null {
  const match = /\/api\/stream\/(\d+)$/.exec(new URL(url).pathname)
  return match?.[1] ? Number(match[1]) : null
}

export interface SyncProgress {
  readonly total: number
  readonly done: number
  readonly bytesDone: number
  readonly bytesTotal: number
  readonly currentTitle: string
  /** The song being fetched right now, so its row can say so. */
  readonly activeSongId: number | null
  readonly failed: number
}

export interface StorageUsage {
  /** Bytes used by cached audio specifically. */
  readonly audioBytes: number
  /** Bytes the whole origin is using, per the Storage API. */
  readonly usedBytes: number
  /** Bytes the browser is willing to give us, if it will say. */
  readonly quotaBytes: number | null
  readonly cachedCount: number
}

function cachesAvailable(): boolean {
  return typeof caches !== 'undefined'
}

/**
 * Whether this browser can keep songs at all. The Cache API only exists in a
 * secure context, so a phone on plain `http://192.168…` has none of this.
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

/**
 * The byte size of each cached song, by id (null when the entry has none).
 *
 * Ids get reused after a song is deleted or the library is reset, so "id 7 is
 * cached" does not mean "the current song 7 is cached". Size is compared
 * rather than ETag because an object-storage ETag never matches the
 * manifest's; a different file of exactly the same size is not a real case.
 */
async function cachedSizes(): Promise<Map<number, number | null>> {
  const sizes = new Map<number, number | null>()
  if (!cachesAvailable()) return sizes
  try {
    const cache = await caches.open(AUDIO_CACHE)
    for (const request of await cache.keys()) {
      const songId = songIdOfKey(request.url)
      if (songId === null) continue
      const response = await cache.match(request)
      const length = Number(response?.headers.get('content-length') ?? Number.NaN)
      sizes.set(songId, Number.isFinite(length) ? length : null)
    }
  } catch {
    // Treat an unreadable cache as empty; the sync will fill it again.
  }
  return sizes
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
export type DownloadFraction = number | null

/**
 * Download one song into the cache.
 *
 * `cache: 'reload'` bypasses the browser's HTTP cache, and `REFRESH_HEADER`
 * bypasses our own service worker, which sits in front of it and would
 * otherwise hand back the very copy this is trying to replace. Both are needed
 * for a re-download after a file changed on the Mac to fetch fresh bytes. The
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

export type ManifestEntry = SyncManifest['entries'][number]

/**
 * The manifest entries this device does not hold yet.
 *
 * Not cached, or cached as a different file than the one the id names now —
 * an entry stored without a length is given the benefit of the doubt. `skip`
 * is the songs the user took off this device by hand, which automatic
 * downloads must not quietly put back.
 */
export async function missingEntries(
  manifest: SyncManifest,
  skip: ReadonlySet<number> = new Set(),
): Promise<ManifestEntry[]> {
  const cachedSize = await cachedSizes()
  return manifest.entries.filter(entry => {
    if (skip.has(entry.id)) return false
    if (!cachedSize.has(entry.id)) return true
    const size = cachedSize.get(entry.id)
    return size != null && size !== entry.sizeBytes
  })
}

/** Drop cached songs that are no longer in the library. Returns how many went. */
export async function pruneCache(keep: ReadonlySet<number>): Promise<number> {
  let removed = 0
  for (const songId of await cachedSongIds()) {
    if (keep.has(songId)) continue
    await uncacheSong(songId)
    removed++
  }
  return removed
}

/**
 * Leave this much of the browser's quota free. Filling it to the last byte
 * gets the whole origin's storage evicted on some browsers, which would take
 * every download with it.
 */
const STORAGE_CEILING = 0.9

async function hasRoomFor(bytes: number): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return true
  try {
    const { usage, quota } = await navigator.storage.estimate()
    if (!quota) return true
    return (usage ?? 0) + bytes <= quota * STORAGE_CEILING
  } catch {
    return true
  }
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
}

/** Why a sync stopped: it finished, it was cancelled, or the device is full. */
export type SyncStop = 'complete' | 'aborted' | 'storage'

/**
 * Download a list of manifest entries into the cache.
 *
 * Sequential rather than parallel: on a phone, four concurrent multi-megabyte
 * downloads make every one of them slower and make progress reporting
 * meaningless. One at a time is both faster in practice and interruptible at
 * a sensible granularity.
 *
 * Storage is checked before each song, not only when a write fails: a failed
 * write can come after the browser has already started evicting.
 */
export async function syncLibrary(
  entries: readonly ManifestEntry[],
  options: {
    titleFor: (songId: number) => string
    onProgress: (progress: SyncProgress) => void
    /** Each song as it lands, so the list can mark it without waiting for the end. */
    onCached?: (songId: number) => void
    /** How far through the current song is, for its row's ring. */
    onSongProgress?: (songId: number, fraction: DownloadFraction) => void
    signal: AbortSignal
  },
): Promise<{ progress: SyncProgress; stop: SyncStop }> {
  let done = 0
  let failed = 0
  let bytesDone = 0
  const bytesTotal = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0)

  const snapshot = (currentTitle: string, activeSongId: number | null): SyncProgress => ({
    total: entries.length,
    done,
    bytesDone,
    bytesTotal,
    currentTitle,
    activeSongId,
    failed,
  })

  options.onProgress(snapshot('', null))

  for (const entry of entries) {
    if (options.signal.aborted) return { progress: snapshot('', null), stop: 'aborted' }
    if (!(await hasRoomFor(entry.sizeBytes)))
      return { progress: snapshot('', null), stop: 'storage' }

    const title = options.titleFor(entry.id)
    options.onProgress(snapshot(title, entry.id))

    try {
      const report = options.onSongProgress
      await cacheSong(
        entry.id,
        options.signal,
        report ? fraction => report(entry.id, fraction) : undefined,
      )
      bytesDone += entry.sizeBytes
      options.onCached?.(entry.id)
    } catch (error) {
      if (options.signal.aborted) return { progress: snapshot('', null), stop: 'aborted' }
      if (isQuotaError(error)) return { progress: snapshot('', null), stop: 'storage' }
      // One bad file should not abandon the other 400.
      failed++
      console.warn(`could not cache song ${entry.id}`, error)
    }

    done++
    options.onProgress(snapshot(title, null))
  }

  return { progress: snapshot('', null), stop: 'complete' }
}

/** How much space the offline library is taking up. */
export async function storageUsage(): Promise<StorageUsage> {
  let audioBytes = 0
  let cachedCount = 0

  if (cachesAvailable()) {
    try {
      const cache = await caches.open(AUDIO_CACHE)
      const keys = await cache.keys()
      cachedCount = keys.length
      // Summing content-length across every entry is cheap: headers only, no
      // bodies are read.
      for (const request of keys) {
        const response = await cache.match(request)
        const length = Number(response?.headers.get('content-length') ?? 0)
        if (Number.isFinite(length)) audioBytes += length
      }
    } catch {
      // Fall through with zeroes.
    }
  }

  let usedBytes = audioBytes
  let quotaBytes: number | null = null

  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate()
      usedBytes = estimate.usage ?? audioBytes
      quotaBytes = estimate.quota ?? null
    } catch {
      // Some browsers refuse; the audio total is still useful on its own.
    }
  }

  return { audioBytes, usedBytes, quotaBytes, cachedCount }
}

/**
 * Ask the browser not to evict our cache under storage pressure.
 *
 * Without this, iOS will quietly delete the offline library after a week or so
 * of not opening the app — which is precisely when you need it.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/**
 * The browser's `OfflineStore`.
 *
 * A thin mapping, which is the point: the port was derived from both apps'
 * offline code, and if the web side had needed reshaping to meet it that would
 * have meant the port was describing something other than what exists.
 *
 * `localUri` is deliberately absent. The browser has nothing to hand back — the
 * service worker intercepts the ordinary stream URL, so the player never learns
 * a copy was involved. That is why the web app plays offline without a line of
 * code about it, and why the port makes that member optional.
 */
export function createWebOfflineStore(): OfflineStore {
  return {
    get available(): boolean {
      return offlineStorageAvailable()
    },
    has: isCached,
    ids: cachedSongIds,
    bytes: cachedBytes,
    /*
     * The one cast in this file, and the right place for it. The port types
     * `signal` as `unknown` because packages/client compiles without the DOM
     * and cannot name `AbortSignal`; naming it again is exactly what a platform
     * implementation is for. A wrong value fails here, at the boundary, rather
     * than somewhere inside the cache.
     */
    save: (songId: number, options?: SaveOptions) =>
      cacheSong(songId, options?.signal as AbortSignal | undefined, options?.onProgress),
    remove: uncacheSong,
    clear: clearAudioCache,
    usage: storageUsage,
    requestPersistence: requestPersistentStorage,
  }
}

/*
 * Does the offline code that has been keeping your music actually satisfy the
 * interface written for it?
 *
 * Same assertion as the engine port, for the same reason: an interface derived
 * from two implementations can still miss one of them by a return type, and the
 * miss would surface when the shared OfflineProvider is written against it —
 * later, and more expensively.
 */
const _conforms: OfflineStore = createWebOfflineStore()
void _conforms

/** And that the port's usage shape is the one this file already returned. */
const _usageConforms: (u: StorageUsage) => PortStorageUsage = u => u
void _usageConforms
