import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { answerFromCloud } from '../api/client'
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
    setFromCloud(true)
    setStatus('ready')
  }, [])

  const connect = useCallback(async (next: ServerConnection) => {
    // Choosing a Mac on purpose means answering from it, not the bucket.
    answerFromCloud(false)
    setFromCloud(false)
    await saveConnection(next)
    setConnection(next)
    setStatus('ready')
  }, [])

  const disconnect = useCallback(async () => {
    await clearConnection()
    setConnection(null)
    setStatus('missing')
  }, [])

  const value = useMemo<ConnectionContextValue>(
    () => ({ connection, fromCloud, status, connect, disconnect, signedInToCloud }),
    [connection, fromCloud, status, connect, disconnect, signedInToCloud],
  )

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext)
  if (!value) throw new Error('useConnection must be used inside a ConnectionProvider')
  return value
}
