import { useEffect } from 'react'
import { useMutationState, useQueryClient } from '@tanstack/react-query'
import { resumableEdits } from '@selfmp3/client'

import { useConnection } from '../connection/ConnectionProvider'
import { prefs } from '../ports/prefs'
import { isWaitingEdit, keptEdits, parseKept, restoreEdits } from './waitingEdits.model'

/**
 * Edits made while the library could not be reached, kept on the device.
 *
 * A browser that goes offline holds every edit back until it is online again
 * (TanStack Query pauses them), and it held them only in memory: a tag ticked
 * offline and then a reload, and it was never sent and never said. So the
 * edits that can wait (`editKeys` in packages/client) are written here as they
 * wait, read back when the app opens on the same library, and sent once it is
 * online — by the same functions their hooks send them with (`resumableEdits`).
 *
 * Kept for one library: a switch of server clears the query client, and what
 * was made for one library is never sent to another.
 */

const KEY = 'waitingEdits'

/** Keep the waiting edits for as long as the app is open on one library. */
export function useKeepWaitingEdits(): void {
  const client = useQueryClient()
  const { status, connection, fromCloud } = useConnection()
  const library = status !== 'ready' ? null : fromCloud ? 'cloud' : (connection?.baseUrl ?? null)

  useEffect(() => {
    if (library === null) return undefined
    resumableEdits(client)
    restoreEdits(client, parseKept(prefs.get(KEY)), library)
    let timer: ReturnType<typeof setTimeout> | null = null
    const keep = (): void => {
      timer = null
      prefs.set(KEY, JSON.stringify(keptEdits(client, library)))
    }
    keep()
    const unsubscribe = client.getMutationCache().subscribe(() => {
      if (timer === null) timer = setTimeout(keep, 200)
    })
    return () => {
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
    }
  }, [client, library])
}

/** How many edits are waiting to be sent: what "All saved" must not be said over. */
export function useWaitingEdits(): number {
  return useMutationState({
    filters: { predicate: isWaitingEdit },
    select: mutation => mutation.mutationId,
  }).length
}
