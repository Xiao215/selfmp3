import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
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
  readonly status: 'loading' | 'ready' | 'missing'
  readonly connect: (connection: ServerConnection) => Promise<void>
  readonly disconnect: () => Promise<void>
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

export function ConnectionProvider({ children }: { children: ReactNode }): ReactNode {
  const [connection, setConnection] = useState<ServerConnection | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    let cancelled = false
    void loadConnection()
      .then(stored => {
        if (cancelled) return
        setConnection(stored)
        setStatus(stored ? 'ready' : 'missing')
      })
      .catch(() => {
        if (!cancelled) setStatus('missing')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const connect = useCallback(async (next: ServerConnection) => {
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
    () => ({ connection, status, connect, disconnect }),
    [connection, status, connect, disconnect],
  )

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext)
  if (!value) throw new Error('useConnection must be used inside a ConnectionProvider')
  return value
}
