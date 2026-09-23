import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ClientStateProvider, type ServerConnection } from '@selfmp3/client'
import type { CloudSession } from '@selfmp3/replica'
import { answerFromCloud, setServer } from '../api/client'
import { forgetImportDraft } from '../features/import/importDraft'
import { library as cloudLibrary, session as cloudSession } from '../replica'
import { storageDue } from '../features/welcome/storage.model'
import { clearConnection, loadConnection, saveConnection } from './storedConnection'

/**
 * Which server this phone talks to.
 *
 * Read from the keychain once at launch; `status` exists so the router can
 * tell "still reading" apart from "never set up", which are the same
 * `connection === null` otherwise and would flash Welcome at every cold start.
 */

interface ConnectionContextValue {
  readonly connection: ServerConnection | null
  /**
   * Whether this device answers from the bucket. Not the same as having no
   * `connection`: an address left over from talking to a server is still stored,
   * and asking "is there a connection?" made covers reach for a server that is
   * not running rather than the copy on this phone.
   */
  readonly fromCloud: boolean
  readonly status: 'loading' | 'ready' | 'missing'
  /**
   * Signed in, but the Google account has no bucket yet: there is no library
   * to show, and Where it lives comes before anything else (`welcome/storage.model.ts`).
   */
  readonly needsStorage: boolean
  readonly connect: (connection: ServerConnection) => Promise<void>
  /** Say the cloud sign-in finished, so the app answers from the bucket. The session says whether it has one. */
  readonly signedInToCloud: (session?: CloudSession) => void
  /** The account's bucket was connected on this device. */
  readonly storageConnected: () => void
  /** The account's bucket was forgotten on this device; it is asked for again. */
  readonly storageForgotten: () => void
  readonly disconnect: () => Promise<void>
  /** Leave the cloud: the session is ended elsewhere first; this forgets the bucket's library and asks again. */
  readonly signedOutOfCloud: () => void
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

export function ConnectionProvider({ children }: { children: ReactNode }): ReactNode {
  const [connection, setConnection] = useState<ServerConnection | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [fromCloud, setFromCloud] = useState(false)
  const [needsStorage, setNeedsStorage] = useState(false)
  const queryClient = useQueryClient()

  /*
   * Forget everything cached for the previous server.
   *
   * Query keys carry no server address, so without this a switch could still
   * show the last server's library while the next one loaded. Clearing here
   * happens once, on the change, rather than in twenty-odd key builders.
   */
  const forgetCachedServer = useCallback(() => {
    queryClient.clear()
  }, [queryClient])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Signed in to the cloud beats everything: the library is then the
      // bucket's, and no server has to be awake or even exist. A stored address
      // is a development build whose address was typed on Welcome instead, which is
      // how the simulator flows get a library without a Google account.
      const [signedIn, server] = await Promise.all([
        cloudSession.loadSession().catch(() => null),
        loadConnection().catch(() => null),
      ])
      if (cancelled) return
      answerFromCloud(signedIn !== null)
      // The API client keeps the address in module state, not in this context:
      // the playback service and the download queue both make requests from
      // outside the component tree, where there is nothing to read a context
      // from. This provider is its only writer.
      setServer(server)
      setFromCloud(signedIn !== null)
      setConnection(server)
      setStatus(signedIn || server ? 'ready' : 'missing')
      setNeedsStorage(storageDue(signedIn))
      // The bucket may have been forgotten from another device since the
      // session was stored, or connected from one: the doorman's answer now,
      // in the background, and the page that asks for a bucket follows it.
      if (signedIn) {
        void cloudSession
          .refreshSession(signedIn)
          .then(next => {
            if (!cancelled) setNeedsStorage(storageDue(next))
          })
          .catch(() => undefined)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Called once Google is done, so the app stops asking for a server. */
  const signedInToCloud = useCallback(
    (session?: CloudSession) => {
      answerFromCloud(true)
      forgetCachedServer()
      setFromCloud(true)
      setNeedsStorage(storageDue(session ?? null))
      setStatus('ready')
    },
    [forgetCachedServer],
  )

  const storageConnected = useCallback(() => {
    // Nothing asked before the bucket was there was an answer worth keeping.
    forgetCachedServer()
    setNeedsStorage(false)
  }, [forgetCachedServer])

  const storageForgotten = useCallback(() => {
    forgetCachedServer()
    setNeedsStorage(true)
  }, [forgetCachedServer])

  const connect = useCallback(
    async (next: ServerConnection) => {
      // Choosing a server on purpose means answering from it, not the bucket.
      answerFromCloud(false)
      setServer(next)
      forgetCachedServer()
      // A review looked up on the last server names its tags; another server's are not those.
      if (connection !== null && connection.baseUrl !== next.baseUrl) forgetImportDraft('own')
      setFromCloud(false)
      await saveConnection(next)
      setConnection(next)
      setStatus('ready')
    },
    [connection, forgetCachedServer],
  )

  const signedOutOfCloud = useCallback(() => {
    answerFromCloud(false)
    cloudLibrary.markCloudLibraryStale()
    forgetCachedServer()
    forgetImportDraft('cloud')
    setFromCloud(false)
    setNeedsStorage(false)
    setStatus(connection ? 'ready' : 'missing')
  }, [connection, forgetCachedServer])

  const disconnect = useCallback(async () => {
    await clearConnection()
    setServer(null)
    forgetCachedServer()
    forgetImportDraft('own')
    setConnection(null)
    setStatus('missing')
  }, [forgetCachedServer])

  const value = useMemo<ConnectionContextValue>(
    () => ({
      connection,
      fromCloud,
      status,
      needsStorage,
      connect,
      disconnect,
      signedInToCloud,
      storageConnected,
      storageForgotten,
      signedOutOfCloud,
    }),
    [
      connection,
      fromCloud,
      status,
      needsStorage,
      connect,
      disconnect,
      signedInToCloud,
      storageConnected,
      storageForgotten,
      signedOutOfCloud,
    ],
  )

  return (
    <ConnectionContext.Provider value={value}>
      {/*
       * `ready` is what every query in the package is gated on. The phone spends
       * the first moment of a cold start reading an address out of the keychain
       * and looking for a cloud session, and until one of those answers there is
       * nowhere to send a request; firing anyway meant an error on screen for
       * the half second before the address arrived.
       */}
      <ClientStateProvider ready={status === 'ready'}>{children}</ClientStateProvider>
    </ConnectionContext.Provider>
  )
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext)
  if (!value) throw new Error('useConnection must be used inside a ConnectionProvider')
  return value
}
