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
 * was made for one library is never sent to another. A cloud library's edits
 * never wait here (`networkModeFor`): they are in the replica's outbox the
 * moment they are made. Only those still on their way as the page goes are
 * kept for it (`keepEditsAsLeaving`). Kept edits name songs, tags and
 * playlists by local ids, which a cloud library keeps across a reload and
 * hands out afresh at each sign-in, so signing out forgets them
 * (`forgetWaitingEdits`): one kept across a sign-in landed on whatever held
 * its ids next.
 */

const KEY = 'waitingEdits'

/** Writes down the edits on their way as well, for a library they would not reach as the page goes. */
let keepSending: (() => void) | null = null

/**
 * The page is going: what it sent as it went is kept to send again on the
 * next open, where nothing carries it past the page (`keptEdits`' `sending`).
 * Called after `sendPending`, whose sends have begun by then. Written at
 * once: the page is gone before any timer runs.
 */
export function keepEditsAsLeaving(): void {
  keepSending?.()
}

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
    keepSending =
      library === 'cloud'
        ? () => prefs.set(KEY, JSON.stringify(keptEdits(client, library, { sending: true })))
        : null
    const unsubscribe = client.getMutationCache().subscribe(() => {
      if (timer === null) timer = setTimeout(keep, 200)
    })
    return () => {
      unsubscribe()
      keepSending = null
      if (timer !== null) clearTimeout(timer)
    }
  }, [client, library])
}

/** Signing out or leaving a server: nothing kept is sent to whatever library comes next. */
export function forgetWaitingEdits(): void {
  prefs.set(KEY, '')
}

/** How many edits are waiting to be sent: what "All saved" must not be said over. */
export function useWaitingEdits(): number {
  return useMutationState({
    filters: { predicate: isWaitingEdit },
    select: mutation => mutation.mutationId,
  }).length
}
