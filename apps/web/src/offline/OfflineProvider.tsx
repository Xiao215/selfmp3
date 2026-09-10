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
import type { Song } from '@selfmp3/shared'
import { api } from '../lib/api.js'
import {
  cachedSongIds,
  cacheSong,
  clearAudioCache,
  requestPersistentStorage,
  storageUsage,
  syncLibrary,
  uncacheSong,
  type StorageUsage,
  type SyncProgress,
} from './audioCache.js'

/**
 * Offline state for the whole app.
 *
 * This is the feature that makes the app usable when the Mac is asleep, so it
 * is deliberately explicit rather than magical: nothing is cached without the
 * user asking, and what *is* cached is always visible and countable.
 */

export type SyncState =
  | { readonly status: 'idle' }
  | { readonly status: 'syncing'; readonly progress: SyncProgress }
  | { readonly status: 'done'; readonly progress: SyncProgress }
  | { readonly status: 'error'; readonly message: string }

interface OfflineContextValue {
  /** True when the browser thinks it has a connection. */
  readonly online: boolean
  /** True when the server actually answered recently. */
  readonly serverReachable: boolean
  readonly cachedIds: ReadonlySet<number>
  readonly usage: StorageUsage | null
  readonly sync: SyncState
  readonly persistent: boolean
  readonly isCached: (songId: number) => boolean

  // Property-arrow rather than method shorthand: these get passed directly to
  // JSX handlers, where method shorthand reads as a detached `this`.
  readonly syncAll: (songs: readonly Song[]) => Promise<void>
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

export function OfflineProvider({ children }: { children: ReactNode }): ReactNode {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [serverReachable, setServerReachable] = useState(true)
  const [cachedIds, setCachedIds] = useState<ReadonlySet<number>>(() => new Set())
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [sync, setSync] = useState<SyncState>({ status: 'idle' })
  const [persistent, setPersistent] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

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

  // `navigator.onLine` only knows about the network interface, not whether the
  // Mac at the other end is awake, so the server is probed separately.
  useEffect(() => {
    const goOnline = (): void => setOnline(true)
    const goOffline = (): void => {
      setOnline(false)
      setServerReachable(false)
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
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
        if (!cancelled) setServerReachable(true)
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

  const syncAll = useCallback(
    async (songs: readonly Song[]) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const manifest = await api.manifest()
        const titles = new Map(songs.map(song => [song.id, song.title]))

        const progress = await syncLibrary(manifest, {
          titleFor: id => titles.get(id) ?? `Song ${id}`,
          onProgress: next => setSync({ status: 'syncing', progress: next }),
          signal: controller.signal,
        })

        setSync({ status: 'done', progress })
        await refreshCached()
        await refreshUsage()
      } catch (error) {
        if (controller.signal.aborted) {
          setSync({ status: 'idle' })
          return
        }
        setSync({
          status: 'error',
          message: error instanceof Error ? error.message : 'sync failed',
        })
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [refreshCached, refreshUsage],
  )

  const cancelSync = useCallback(() => {
    abortRef.current?.abort()
    setSync({ status: 'idle' })
  }, [])

  const downloadOne = useCallback(
    async (songId: number) => {
      await cacheSong(songId)
      setCachedIds(previous => new Set(previous).add(songId))
      void refreshUsage()
    },
    [refreshUsage],
  )

  const removeOne = useCallback(
    async (songId: number) => {
      await uncacheSong(songId)
      setCachedIds(previous => {
        const next = new Set(previous)
        next.delete(songId)
        return next
      })
      void refreshUsage()
    },
    [refreshUsage],
  )

  const clearAll = useCallback(async () => {
    abortRef.current?.abort()
    await clearAudioCache()
    setCachedIds(new Set())
    setSync({ status: 'idle' })
    await refreshUsage()
  }, [refreshUsage])

  const isCached = useCallback((songId: number) => cachedIds.has(songId), [cachedIds])

  const value = useMemo<OfflineContextValue>(
    () => ({
      online,
      serverReachable,
      cachedIds,
      usage,
      sync,
      persistent,
      isCached,
      syncAll,
      cancelSync,
      downloadOne,
      removeOne,
      clearAll,
      refreshUsage,
    }),
    [
      online,
      serverReachable,
      cachedIds,
      usage,
      sync,
      persistent,
      isCached,
      syncAll,
      cancelSync,
      downloadOne,
      removeOne,
      clearAll,
      refreshUsage,
    ],
  )

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}
