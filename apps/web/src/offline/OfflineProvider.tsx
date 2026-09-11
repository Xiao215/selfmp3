import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { queryKeys, useLibrary } from '../lib/queries.js'
import {
  cachedSongIds,
  cacheSong,
  clearAudioCache,
  missingEntries,
  offlineStorageAvailable,
  pruneCache,
  requestPersistentStorage,
  storageUsage,
  syncLibrary,
  uncacheSong,
  type DownloadFraction,
  type ManifestEntry,
  type StorageUsage,
  type SyncProgress,
  type SyncStop,
} from './audioCache.js'
import {
  connectionKind,
  loadExcluded,
  loadPrefs,
  onConnectionChange,
  saveExcluded,
  savePrefs,
  type OfflinePrefs,
} from './autoDownload.js'
import { flushListens, loadPendingListens, subscribePendingListens } from './playOutbox.js'

/**
 * Offline state for the whole app.
 *
 * This is the feature that makes the app usable when the Mac is asleep. Three
 * jobs live here:
 *
 * - **Downloads.** By default this device keeps every song — or every song in
 *   a playlist — without being asked: on Wi-Fi, whenever the Mac is reachable,
 *   until the device is nearly full. What is cached is always visible and
 *   countable, and anything can be turned off.
 * - **Plays made offline.** Held on the device (`playOutbox.ts`) and sent the
 *   moment the Mac answers again.
 * - **Reachability.** `navigator.onLine` knows about the network, not about
 *   whether the Mac at the other end is awake, so the server is probed too.
 */

export type SyncState =
  | { readonly status: 'idle' }
  | { readonly status: 'syncing'; readonly progress: SyncProgress }
  | { readonly status: 'done'; readonly progress: SyncProgress }
  | { readonly status: 'error'; readonly message: string }

/** Why automatic downloads are, or are not, doing anything right now. */
export type AutoState =
  | { readonly kind: 'off' }
  /** No Cache API: an insecure origin, or a browser without it. */
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'up-to-date' }
  | {
      readonly kind: 'waiting'
      /** `metered`: on cellular. `unknown-connection`: the browser will not say. */
      readonly reason: 'metered' | 'unknown-connection'
      readonly missing: number
    }
  | { readonly kind: 'storage-full'; readonly missing: number }

interface OfflineContextValue {
  /** True when the browser thinks it has a connection. */
  readonly online: boolean
  /** True when the server actually answered recently. */
  readonly serverReachable: boolean
  /** False where the browser cannot keep songs at all. */
  readonly supported: boolean
  readonly cachedIds: ReadonlySet<number>
  readonly usage: StorageUsage | null
  readonly sync: SyncState
  readonly persistent: boolean
  readonly isCached: (songId: number) => boolean
  /** Taken off this device by hand, so automatic downloads leave it alone. */
  readonly isExcluded: (songId: number) => boolean
  /**
   * How far a song's download has got: 0–1, null while the size is unknown,
   * or undefined when it is not downloading at all.
   */
  readonly progressOf: (songId: number) => DownloadFraction | undefined

  readonly prefs: OfflinePrefs
  readonly auto: AutoState
  /** Plays and skips made on this device that the server has not heard about. */
  readonly pendingListens: number

  // Property-arrow rather than method shorthand: these get passed directly to
  // JSX handlers, where method shorthand reads as a detached `this`.
  readonly setPrefs: (patch: Partial<OfflinePrefs>) => void
  /** Download what is missing now, whatever the connection. */
  readonly downloadNow: () => Promise<void>
  readonly cancelSync: () => void
  readonly downloadOne: (songId: number) => Promise<void>
  readonly removeOne: (songId: number) => Promise<void>
  readonly clearAll: () => Promise<void>
  readonly refreshUsage: () => Promise<void>
}

const OfflineContext = createContext<OfflineContextValue | null>(null)

export function useOffline(): OfflineContextValue {
  const context = useContext(OfflineContext)
  if (!context) throw new Error('useOffline must be used inside <OfflineProvider>')
  return context
}

/**
 * Settle for this long after something changes before checking. An import of
 * twenty songs bumps the library twenty times; one check afterwards is enough.
 */
const AUTO_DELAY_MS = 1500

export function OfflineProvider({ children }: { children: ReactNode }): ReactNode {
  const queryClient = useQueryClient()
  const { data: library } = useLibrary()

  const [online, setOnline] = useState(() => navigator.onLine)
  const [serverReachable, setServerReachable] = useState(true)
  const [cachedIds, setCachedIds] = useState<ReadonlySet<number>>(() => new Set())
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [sync, setSync] = useState<SyncState>({ status: 'idle' })
  const [persistent, setPersistent] = useState(false)
  const [prefs, setPrefsState] = useState<OfflinePrefs>(() => loadPrefs())
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => loadExcluded())
  const [auto, setAuto] = useState<AutoState>({ kind: 'up-to-date' })
  const [pendingListens, setPendingListens] = useState(0)
  const [connectionTick, setConnectionTick] = useState(0)
  const [downloading, setDownloading] = useState<ReadonlyMap<number, DownloadFraction>>(
    () => new Map(),
  )

  /**
   * Per-song progress, for the ring on its row. A chunk arrives every few
   * kilobytes; re-rendering the list for each would be wasteful, so progress
   * is only passed on in 2% steps.
   */
  const lastStepRef = useRef(new Map<number, number>())
  const reportProgress = useCallback((songId: number, fraction: DownloadFraction) => {
    const step = fraction === null ? -1 : Math.floor(fraction * 50)
    if (lastStepRef.current.get(songId) === step) return
    lastStepRef.current.set(songId, step)
    setDownloading(previous => new Map(previous).set(songId, fraction))
  }, [])
  const finishProgress = useCallback((songId: number) => {
    lastStepRef.current.delete(songId)
    setDownloading(previous => {
      if (!previous.has(songId)) return previous
      const next = new Map(previous)
      next.delete(songId)
      return next
    })
  }, [])

  const supported = offlineStorageAvailable()

  // Refs for the async passes, which must read the latest values without
  // being re-created (and re-scheduled) by every render.
  const abortRef = useRef<AbortController | null>(null)
  const runningRef = useRef(false)
  const rerunRef = useRef(false)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const excludedRef = useRef(excluded)
  excludedRef.current = excluded
  const titlesRef = useRef(new Map<number, string>())
  titlesRef.current = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song.title])),
    [library],
  )
  const libraryIdsRef = useRef<readonly number[]>([])
  libraryIdsRef.current = useMemo(() => (library?.songs ?? []).map(song => song.id), [library])
  /** What the last pass found nothing to do about, so an unrelated bump can skip the work. */
  const settledRef = useRef<string | null>(null)

  const refreshCached = useCallback(async () => {
    setCachedIds(await cachedSongIds())
  }, [])

  const refreshUsage = useCallback(async () => {
    setUsage(await storageUsage())
  }, [])

  useEffect(() => {
    void refreshCached()
    void refreshUsage()
    void requestPersistentStorage().then(setPersistent)
  }, [refreshCached, refreshUsage])

  const setPrefs = useCallback((patch: Partial<OfflinePrefs>) => {
    setPrefsState(current => {
      const next = { ...current, ...patch }
      savePrefs(next)
      return next
    })
    settledRef.current = null
  }, [])

  const updateExcluded = useCallback((change: (ids: Set<number>) => void) => {
    setExcluded(current => {
      const next = new Set(current)
      change(next)
      saveExcluded(next)
      return next
    })
    settledRef.current = null
  }, [])

  // --- plays made offline ----------------------------------------------------

  useEffect(() => subscribePendingListens(setPendingListens), [])
  useEffect(() => {
    void loadPendingListens()
  }, [])

  /** Send the backlog; if anything went, the counts on screen are stale. */
  const flushBacklog = useCallback(async () => {
    const sent = await flushListens()
    if (sent > 0) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library })
      void queryClient.invalidateQueries({ queryKey: ['stats'] })
    }
  }, [queryClient])
  const flushBacklogRef = useRef(flushBacklog)
  flushBacklogRef.current = flushBacklog

  // --- reachability ----------------------------------------------------------

  useEffect(() => {
    const goOnline = (): void => setOnline(true)
    const goOffline = (): void => {
      setOnline(false)
      setServerReachable(false)
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    const stopWatching = onConnectionChange(() => setConnectionTick(tick => tick + 1))
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      stopWatching()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const probe = async (): Promise<void> => {
      if (!navigator.onLine) {
        if (!cancelled) setServerReachable(false)
        return
      }
      try {
        await api.health()
        if (cancelled) return
        setServerReachable(true)
        // Already reachable means no state change to react to, so the backlog
        // is nudged from here too — a play that failed a minute ago goes now.
        void flushBacklogRef.current()
      } catch {
        if (!cancelled) setServerReachable(false)
      }
    }

    void probe()
    const timer = setInterval(() => void probe(), 30_000)
    // Check straight away when the app comes back to the foreground, so the
    // "offline" banner disappears the moment the Mac wakes up.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void probe()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // --- downloads -------------------------------------------------------------

  const runDownloads = useCallback(
    async (entries: readonly ManifestEntry[]): Promise<{ stop: SyncStop; done: number }> => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const { progress, stop } = await syncLibrary(entries, {
          titleFor: id => titlesRef.current.get(id) ?? `Song ${id}`,
          onProgress: next => setSync({ status: 'syncing', progress: next }),
          onSongProgress: reportProgress,
          onCached: id => {
            finishProgress(id)
            setCachedIds(previous => new Set(previous).add(id))
          },
          signal: controller.signal,
        })
        setSync(stop === 'aborted' ? { status: 'idle' } : { status: 'done', progress })
        return { stop, done: progress.done }
      } catch (error) {
        setSync({
          status: 'error',
          message: error instanceof Error ? error.message : 'download failed',
        })
        return { stop: 'aborted', done: 0 }
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        // A song that failed or was cancelled leaves no ring behind.
        for (const entry of entries) finishProgress(entry.id)
        await refreshCached()
        await refreshUsage()
      }
    },
    [refreshCached, refreshUsage, reportProgress, finishProgress],
  )

  /**
   * Work out what this device is missing, and tidy up on the way.
   *
   * Songs that have left the library are dropped from the cache here — only
   * ever against a fresh answer from the server, and never a song the library
   * still has, even one whose file is missing on the Mac today.
   */
  const plan = useCallback(async (): Promise<{ missing: ManifestEntry[]; signature: string }> => {
    const { scope } = prefsRef.current
    const manifest = await api.manifest(scope)
    const whole = scope === 'library' ? manifest : await api.manifest('library')

    // Most library bumps are a tag or a rename, which change no file. When the
    // files are exactly what the last pass found fully downloaded, skip
    // reading every cache entry's size again.
    const signature = [
      scope,
      whole.entries.map(entry => `${entry.id}:${entry.sizeBytes}`).join(','),
      manifest.entries.length,
      [...excludedRef.current].join(','),
    ].join('|')
    if (settledRef.current === signature) return { missing: [], signature }

    const keep = new Set([...whole.entries.map(entry => entry.id), ...libraryIdsRef.current])
    if ((await pruneCache(keep)) > 0) await refreshCached()

    return { missing: await missingEntries(manifest, excludedRef.current), signature }
  }, [refreshCached])

  const autoPass = useCallback(async (): Promise<void> => {
    if (runningRef.current) {
      rerunRef.current = true
      return
    }
    runningRef.current = true

    try {
      const { missing, signature } = await plan()
      if (missing.length === 0) {
        settledRef.current = signature
        setAuto({ kind: 'up-to-date' })
        return
      }

      const connection = connectionKind()
      if (prefsRef.current.wifiOnly && connection !== 'unmetered') {
        setAuto({
          kind: 'waiting',
          reason: connection === 'metered' ? 'metered' : 'unknown-connection',
          missing: missing.length,
        })
        return
      }

      setAuto({ kind: 'up-to-date' })
      const { stop, done } = await runDownloads(missing)
      if (stop === 'storage') setAuto({ kind: 'storage-full', missing: missing.length - done })
    } catch {
      // The Mac went away mid-check. The next moment it is reachable tries again.
    } finally {
      runningRef.current = false
      if (rerunRef.current) {
        rerunRef.current = false
        if (prefsRef.current.auto) window.setTimeout(() => void autoPassRef.current(), 0)
      }
    }
  }, [plan, runDownloads])
  const autoPassRef = useRef(autoPass)
  autoPassRef.current = autoPass

  const libraryVersion = library?.version
  useEffect(() => {
    if (!supported) {
      setAuto({ kind: 'unsupported' })
      return
    }
    if (!prefs.auto) {
      setAuto({ kind: 'off' })
      return
    }
    if (!serverReachable) return
    const timer = window.setTimeout(() => void autoPass(), AUTO_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [
    supported,
    prefs.auto,
    prefs.scope,
    prefs.wifiOnly,
    serverReachable,
    libraryVersion,
    connectionTick,
    excluded,
    autoPass,
  ])

  const downloadNow = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    try {
      const { missing, signature } = await plan()
      if (missing.length === 0) {
        settledRef.current = signature
        setSync({
          status: 'done',
          progress: {
            total: 0,
            done: 0,
            bytesDone: 0,
            bytesTotal: 0,
            currentTitle: '',
            activeSongId: null,
            failed: 0,
          },
        })
        if (prefsRef.current.auto) setAuto({ kind: 'up-to-date' })
        return
      }
      const { stop, done } = await runDownloads(missing)
      if (stop === 'storage') setAuto({ kind: 'storage-full', missing: missing.length - done })
      else if (prefsRef.current.auto) setAuto({ kind: 'up-to-date' })
    } catch (error) {
      setSync({
        status: 'error',
        message: error instanceof Error ? error.message : 'could not reach your library',
      })
    } finally {
      runningRef.current = false
    }
  }, [plan, runDownloads])

  const cancelSync = useCallback(() => {
    abortRef.current?.abort()
    setSync({ status: 'idle' })
  }, [])

  const downloadOne = useCallback(
    async (songId: number) => {
      // Asking for a song by hand undoes having removed it by hand.
      if (excludedRef.current.has(songId)) updateExcluded(ids => ids.delete(songId))
      // The ring appears the moment it is asked for, before the first byte.
      reportProgress(songId, 0)
      try {
        await cacheSong(songId, undefined, fraction => reportProgress(songId, fraction))
        setCachedIds(previous => new Set(previous).add(songId))
      } finally {
        finishProgress(songId)
      }
      void refreshUsage()
    },
    [refreshUsage, updateExcluded, reportProgress, finishProgress],
  )

  const removeOne = useCallback(
    async (songId: number) => {
      await uncacheSong(songId)
      // Remembered, so the next automatic pass does not put it straight back.
      updateExcluded(ids => ids.add(songId))
      setCachedIds(previous => {
        const next = new Set(previous)
        next.delete(songId)
        return next
      })
      void refreshUsage()
    },
    [refreshUsage, updateExcluded],
  )

  const clearAll = useCallback(async () => {
    abortRef.current?.abort()
    await clearAudioCache()
    setCachedIds(new Set())
    setSync({ status: 'idle' })
    // With automatic downloads on, an emptied cache would simply fill again —
    // clearing it is a decision to stop, so it is taken as one.
    setPrefs({ auto: false })
    await refreshUsage()
  }, [refreshUsage, setPrefs])

  const isCached = useCallback((songId: number) => cachedIds.has(songId), [cachedIds])
  const isExcluded = useCallback((songId: number) => excluded.has(songId), [excluded])
  const progressOf = useCallback((songId: number) => downloading.get(songId), [downloading])

  const value = useMemo<OfflineContextValue>(
    () => ({
      online,
      serverReachable,
      supported,
      cachedIds,
      usage,
      sync,
      persistent,
      isCached,
      isExcluded,
      progressOf,
      prefs,
      auto,
      pendingListens,
      setPrefs,
      downloadNow,
      cancelSync,
      downloadOne,
      removeOne,
      clearAll,
      refreshUsage,
    }),
    [
      online,
      serverReachable,
      supported,
      cachedIds,
      usage,
      sync,
      persistent,
      isCached,
      isExcluded,
      progressOf,
      prefs,
      auto,
      pendingListens,
      setPrefs,
      downloadNow,
      cancelSync,
      downloadOne,
      removeOne,
      clearAll,
      refreshUsage,
    ],
  )

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}
