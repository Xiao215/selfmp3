import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLibrary, useManifest } from '../api/queries'
import { useConnection } from '../server/ConnectionProvider'
import { downloadQueue, type DownloadQueue, type DownloadState } from './downloads'

/**
 * React's view of the download queue.
 *
 * The queue itself is a module-level singleton (downloads outlive screens);
 * this only mirrors its state into React and keeps it pointed at the current
 * server and library.
 */

interface DownloadsContextValue {
  readonly state: DownloadState
  readonly queue: DownloadQueue
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null)

export function DownloadsProvider({ children }: { children: ReactNode }): ReactNode {
  const { connection } = useConnection()
  const library = useLibrary()
  const manifest = useManifest()
  const [state, setState] = useState<DownloadState>(() => downloadQueue.getState())

  useEffect(() => downloadQueue.subscribe(setState), [])

  useEffect(() => {
    void downloadQueue.load()
  }, [])

  useEffect(() => {
    downloadQueue.configure(connection, library.data?.songs ?? [])
  }, [connection, library.data])

  useEffect(() => {
    downloadQueue.setManifest(manifest.data ?? null)
  }, [manifest.data])

  const value = useMemo<DownloadsContextValue>(
    () => ({ state, queue: downloadQueue }),
    [state],
  )

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>
}

export function useDownloads(): DownloadsContextValue {
  const value = useContext(DownloadsContext)
  if (!value) throw new Error('useDownloads must be used inside a DownloadsProvider')
  return value
}
