import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ClientStateProvider } from '@selfmp3/client'
import { answerFromCloud, setServer } from '../api/client'
import { session as cloudSession } from '../cloud'
import {
  clearConnection,
  loadConnection,
  saveConnection,
  type ServerConnection,
} from './connection'

/**
 * Which server this phone talks to.
 *
 * Read from the keychain once at launch; `status` exists so the router can
 * tell "still reading" apart from "never set up", which are the same
 * `connection === null` otherwise and would flash the onboarding screen at
 * every cold start.
 */

interface ConnectionContextValue {
  readonly connection: ServerConnection | null
  /**
   * Whether this device answers from the bucket. Not the same as having no
   * `connection`: an address left over from talking to a Mac is still stored,
   * and asking "is there a connection?" made covers reach for a Mac that is
   * not running rather than the copy on this phone.
   */
  readonly fromCloud: boolean
  readonly status: 'loading' | 'ready' | 'missing'
  readonly connect: (connection: ServerConnection) => Promise<void>
  /** Say the cloud sign-in finished, so the app answers from the bucket. */
  readonly signedInToCloud: () => void
  readonly disconnect: () => Promise<void>
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

export function ConnectionProvider({ children }: { children: ReactNode }): ReactNode {
  const [connection, setConnection] = useState<ServerConnection | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [fromCloud, setFromCloud] = useState(false)
  const queryClient = useQueryClient()

  /*
   * Forget everything cached for the previous server.
   *
   * The phone's query keys used to carry the Mac's address for this reason, so
   * that pointing at a different one could not show the last one's library
   * while the new one loaded. The keys are the web app's now and carry no
   * address, so the forgetting happens here instead — once, on the change,
   * rather than in twenty-odd key builders.
   */
  const forgetCachedServer = useCallback(() => {
    queryClient.clear()
  }, [queryClient])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Signed in to the cloud beats everything: the library is then the
      // bucket's, and no Mac has to be awake or even exist. A stored server
      // address is the older way in, and still works for anyone using it.
      const [signedIn, stored] = await Promise.all([
        cloudSession.loadSession().catch(() => null),
        loadConnection().catch(() => null),
      ])
      if (cancelled) return
      answerFromCloud(signedIn !== null)
      // The API client keeps the address in module state, not in this context:
      // the playback service and the download queue both make requests from
      // outside the component tree, where there is nothing to read a context
      // from. This provider is its only writer.
      setServer(stored)
      setFromCloud(signedIn !== null)
      setConnection(stored)
      setStatus(signedIn || stored ? 'ready' : 'missing')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Called once Google is done, so the app stops asking for a Mac. */
  const signedInToCloud = useCallback(() => {
    answerFromCloud(true)
    forgetCachedServer()
    setFromCloud(true)
    setStatus('ready')
  }, [forgetCachedServer])

  const connect = useCallback(async (next: ServerConnection) => {
    // Choosing a Mac on purpose means answering from it, not the bucket.
    answerFromCloud(false)
    setServer(next)
    forgetCachedServer()
    setFromCloud(false)
    await saveConnection(next)
    setConnection(next)
    setStatus('ready')
  }, [forgetCachedServer])

  const disconnect = useCallback(async () => {
    await clearConnection()
    setServer(null)
    forgetCachedServer()
    setConnection(null)
    setStatus('missing')
  }, [forgetCachedServer])

  const value = useMemo<ConnectionContextValue>(
    () => ({ connection, fromCloud, status, connect, disconnect, signedInToCloud }),
    [connection, fromCloud, status, connect, disconnect, signedInToCloud],
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
