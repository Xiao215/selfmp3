/**
 * `OfflineStore` — where a song lives once this device has kept a copy.
 *
 * The browser keeps them in the Cache API, sliced back out by a service worker
 * so a range request still seeks. The phone keeps files on disk beside a JSON
 * index. Neither belongs in this package; this is what `OfflineProvider` is
 * written against so there is one of it.
 *
 * Deliberately only the storage, not the downloading. The two apps have very
 * different shapes today — the browser's is free functions over the Cache API,
 * the phone's is a stateful `DownloadQueue` with pause, resume and retry — but
 * the difference is not platform, it is that the queue was written twice.
 * Ordering, progress, pausing and what to do about a failure are policy, and
 * policy goes in the shared provider above this. What genuinely differs is
 * where the bytes go, and that is all this names.
 */

/** What this device has spent, and what it is allowed. */
export interface StorageUsage {
  /** Bytes used by kept songs specifically. */
  readonly audioBytes: number
  /** Bytes everything on this origin or in this app is using. */
  readonly usedBytes: number
  /** What the platform is willing to give, where it will say. */
  readonly quotaBytes: number | null
  readonly cachedCount: number
}

/** Fraction of the download done, or null where the size is not known yet. */
export type DownloadFraction = number | null

export interface SaveOptions {
  /**
   * Structural, rather than the DOM's `AbortSignal`, which this package cannot
   * name — the same convention `ClientRequestInit` already uses. Both
   * platforms' real signals satisfy it.
   */
  readonly signal?: unknown
  /** Called as bytes arrive, so a row's progress ring can fill. */
  readonly onProgress?: (fraction: DownloadFraction) => void
}

export interface OfflineStore {
  /**
   * Whether this device can keep songs at all.
   *
   * Not a constant: the Cache API exists only in a secure context, so the same
   * browser build has it at `https://` and not at `http://192.168.1.10:4600`.
   * Everything offline in the UI hangs off this.
   */
  readonly available: boolean

  has(songId: number): Promise<boolean>
  /** Everything kept, for deciding what a whole library view can play. */
  ids(): Promise<Set<number>>
  /** Sizes, so a list can show them without opening each song. */
  bytes(ids: Iterable<number>): Promise<Map<number, number>>

  /** Fetch and keep one song. Resolves to the bytes written. */
  save(songId: number, options?: SaveOptions): Promise<number>
  remove(songId: number): Promise<void>
  clear(): Promise<void>

  usage(): Promise<StorageUsage>

  /**
   * Where the kept copy is, for a player that takes a URL and nothing else.
   *
   * Optional because it is genuinely asymmetric rather than merely unwritten.
   * The phone needs it: track-player is handed a file path and plays it. The
   * browser has nothing to hand back — its service worker intercepts the
   * ordinary stream URL, so the player never knows a copy was involved, which
   * is why the web app plays offline without a line of code about it.
   */
  localUri?(songId: number): string | null

  /**
   * Ask not to be evicted under storage pressure.
   *
   * Optional and best-effort: the browser may refuse or ignore it, and a phone
   * has nothing to ask. A false answer is not an error, it is the platform
   * saying it will decide for itself.
   */
  requestPersistence?(): Promise<boolean>
}
