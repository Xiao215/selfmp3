import type { SyncManifest } from '@selfmp3/shared'

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

/** Cache keys are the stream URLs themselves, so the SW can match on request. */
export function audioCacheKey(songId: number): string {
  return `/api/stream/${songId}`
}

export interface SyncProgress {
  readonly total: number
  readonly done: number
  readonly bytesDone: number
  readonly bytesTotal: number
  readonly currentTitle: string
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

/** Ids of every song currently held offline. */
export async function cachedSongIds(): Promise<Set<number>> {
  if (!cachesAvailable()) return new Set()
  try {
    const cache = await caches.open(AUDIO_CACHE)
    const keys = await cache.keys()
    const ids = new Set<number>()
    for (const request of keys) {
      const match = /\/api\/stream\/(\d+)/.exec(new URL(request.url).pathname)
      if (match?.[1]) ids.add(Number(match[1]))
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
      const match = /\/api\/stream\/(\d+)/.exec(new URL(request.url).pathname)
      if (!match?.[1]) continue
      const response = await cache.match(request)
      const length = Number(response?.headers.get('content-length') ?? Number.NaN)
      sizes.set(Number(match[1]), Number.isFinite(length) ? length : null)
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
 * Download one song into the cache.
 *
 * `cache: 'reload'` bypasses the HTTP cache so a re-download after a file
 * changed on the Mac actually fetches fresh bytes. The response is only stored
 * if it is a complete 200 — caching a partial 206 would poison the cache with
 * a fragment that plays for four seconds and stops.
 */
export async function cacheSong(songId: number, signal?: AbortSignal): Promise<number> {
  if (!cachesAvailable()) throw new Error('offline storage is not available in this browser')

  const cache = await caches.open(AUDIO_CACHE)
  const url = audioCacheKey(songId)

  const response = await fetch(url, {
    cache: 'reload',
    ...(signal ? { signal } : {}),
  })

  if (!response.ok || response.status !== 200) {
    throw new Error(`could not download song ${songId} (${response.status})`)
  }

  const size = Number(response.headers.get('content-length') ?? 0)
  await cache.put(url, response.clone())
  return Number.isFinite(size) ? size : 0
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

/**
 * Bring the offline cache in line with the manifest.
 *
 * Downloads sequentially rather than in parallel: on a phone, four concurrent
 * multi-megabyte downloads make every one of them slower and make progress
 * reporting meaningless. One at a time is both faster in practice and
 * interruptible at a sensible granularity.
 */
export async function syncLibrary(
  manifest: SyncManifest,
  options: {
    titleFor: (songId: number) => string
    onProgress: (progress: SyncProgress) => void
    signal: AbortSignal
    /** Remove cached songs that are no longer in the library. */
    prune?: boolean
  },
): Promise<SyncProgress> {
  const cachedSize = await cachedSizes()
  const wanted = new Set(manifest.entries.map(entry => entry.id))

  if (options.prune !== false) {
    for (const songId of cachedSize.keys()) {
      if (!wanted.has(songId)) await uncacheSong(songId)
    }
  }

  // Not cached, or cached as a different file than the one the id names now.
  // An entry stored without a length is given the benefit of the doubt.
  const missing = manifest.entries.filter(entry => {
    if (!cachedSize.has(entry.id)) return true
    const size = cachedSize.get(entry.id)
    return size != null && size !== entry.sizeBytes
  })

  let done = 0
  let failed = 0
  let bytesDone = 0
  const bytesTotal = missing.reduce((sum, entry) => sum + entry.sizeBytes, 0)

  const report = (currentTitle: string): void => {
    options.onProgress({
      total: missing.length,
      done,
      bytesDone,
      bytesTotal,
      currentTitle,
      failed,
    })
  }

  report('')

  for (const entry of missing) {
    if (options.signal.aborted) break
    const title = options.titleFor(entry.id)
    report(title)

    try {
      await cacheSong(entry.id, options.signal)
      bytesDone += entry.sizeBytes
    } catch (error) {
      if (options.signal.aborted) break
      // One bad file should not abandon the other 400.
      failed++
      console.warn(`could not cache song ${entry.id}`, error)
    }

    done++
    report(title)
  }

  return { total: missing.length, done, bytesDone, bytesTotal, currentTitle: '', failed }
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
