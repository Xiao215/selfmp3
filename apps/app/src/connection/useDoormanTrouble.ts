import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError, queryKeys } from '@selfmp3/client'
import { DOORMAN_PATHS } from '@selfmp3/shared'
import {
  bucketHold,
  bucketRefusals,
  doormanTrouble,
  lapseBucketHold,
  onDoormanTrouble,
  type DoormanTrouble,
} from '@selfmp3/replica'
import { useBucketHold } from '../features/profile/useBucketHold'
import { askBucketAgain } from '../ports/askBucketAgain'
import { useTabHidden } from '../ports/tabHidden'
import { library as cloudLibrary, session as cloudSession } from '../replica'
import { ASK_BEFORE_END_MS, askBucketNow } from './bucketAsk.model'

/**
 * Whether the doorman is answering a cloud library, as the last request found
 * (packages/replica/src/reach.ts): null while it is.
 */
export function useDoormanTrouble(): DoormanTrouble | null {
  return useSyncExternalStore(onDoormanTrouble, doormanTrouble, () => null)
}

/** How often the doorman is asked whether it is back, while nothing answers it. */
const ASK_BACK_EVERY_MS = 10_000

/** How often what failed is asked for again while the doorman answers with errors. */
const RETRY_FAILED_MS = 30_000

/**
 * While the doorman is in trouble, find out when it is over, and then catch up.
 *
 * Nothing answering: its health is asked now and then — the doorman's own
 * answer, which costs the bucket nothing — and at once when the device says
 * its network came back. Answering with errors: what failed is asked for
 * again. A cloud library asks the doorman little by itself (a look at the
 * bucket a minute or two apart), and a server's heartbeats, which ask again
 * for a server library, say nothing of the doorman — so without this the
 * notice outlived the outage by minutes, and Home and Library, which had said
 * "self.mp3 asks again by itself", did not until they were reopened.
 *
 * Over, what failed meanwhile is asked for again and the edits that waited
 * go up.
 */
export function useAskDoormanBack(fromCloud: boolean): void {
  const client = useQueryClient()
  const trouble = useDoormanTrouble()
  const kind = fromCloud ? (trouble?.kind ?? null) : null
  const was = useRef(kind)

  useEffect(() => {
    const before = was.current
    was.current = kind
    if (before === null || kind !== null) return
    refetchFailed(client)
    if (cloudLibrary.pendingCloudChanges() > 0) void cloudLibrary.flushCloudChanges()
  }, [kind, client])

  useEffect(() => {
    if (kind !== 'unreachable' && kind !== 'failing') return undefined
    const ask =
      kind === 'unreachable'
        ? () => void cloudSession.doormanFetch(null, DOORMAN_PATHS.health).catch(() => undefined)
        : () => refetchFailed(client)
    const timer = setInterval(ask, kind === 'unreachable' ? ASK_BACK_EVERY_MS : RETRY_FAILED_MS)
    const stopHearing = onlineManager.subscribe(online => {
      if (online) ask()
    })
    return () => {
      clearInterval(timer)
      stopHearing()
    }
  }, [kind, client])
}

/**
 * Whatever is on screen and failed for want of an answer: the library, a
 * playlist's songs. A refusal is an answer (a song with no words), and
 * asking again would only hear it again.
 */
function refetchFailed(client: QueryClient): void {
  void client.refetchQueries({
    type: 'active',
    predicate: ({ state }) =>
      state.status === 'error' && !(state.error instanceof ApiError && !state.error.isUnanswered),
  })
}

/** How often the edits a cloud library holds back are counted, while the foot shows. */
const COUNT_EVERY_MS = 1_000

/**
 * The edits a cloud library has not sent yet, counted as they change: the
 * replica's outbox says nothing when it empties, so it is counted every
 * second — a number in memory, and a render only when it moves.
 */
export function useCloudUnsent(fromCloud: boolean): number {
  return useCloudOutbox(fromCloud, () => cloudLibrary.pendingCloudChanges(), 0)
}

/**
 * Whether those wait because sending them failed, read the same way. The
 * doorman answering anything else ends its trouble (reach.ts), and the foot
 * went back to a green dot over edits the bucket kept refusing.
 */
export function useCloudStuck(fromCloud: boolean): boolean {
  return useCloudOutbox(fromCloud, () => cloudLibrary.cloudChangesStuck(), false)
}

function useCloudOutbox<T>(fromCloud: boolean, read: () => T, none: T): T {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!fromCloud) return () => {}
      const timer = setInterval(listener, COUNT_EVERY_MS)
      return () => clearInterval(timer)
    },
    [fromCloud],
  )
  return useSyncExternalStore(
    subscribe,
    () => (fromCloud ? read() : none),
    () => none,
  )
}

/**
 * Ask the bucket again by itself while it refuses for the day: just before a
 * hold runs out, while the page is in view, and when the page is looked at
 * again (`askBucketNow`; a song pressed asks in `DownloadsProvider`). A cap
 * raised at backblaze.com was otherwise noticed only by someone pressing Try
 * again, and until then the notice went on promising hours more (R2-M9).
 * A hidden tab asks nothing until it is looked at.
 */
export function useAskBucketBack(fromCloud: boolean): void {
  const hold = useBucketHold()
  const hidden = useTabHidden()
  const askAgain = useAskBucketAgain()
  const wasHidden = useRef(hidden)

  useEffect(() => {
    const returned = wasHidden.current && !hidden
    wasHidden.current = hidden
    if (!fromCloud || !returned) return
    if (askBucketNow('returned', bucketHold(), bucketRefusals(), Date.now())) askAgain()
  }, [fromCloud, hidden, askAgain])

  useEffect(() => {
    if (!fromCloud || hold === null || hidden) return undefined
    const timer = setTimeout(askAgain, Math.max(0, hold.until - Date.now() - ASK_BEFORE_END_MS))
    return () => clearTimeout(timer)
  }, [fromCloud, hold, hidden, askAgain])
}

/**
 * Try again, on a storage refusing for the day, and the asking the app does by
 * itself: the bucket looked at, and what waited sent. Without it, a cap raised
 * at backblaze.com was not noticed until the hold ran out, and the notice
 * saying so had nothing to press.
 *
 * Reads refused, one read finds out (`askBucketRead`) — the look only lists,
 * which Backblaze caps apart — sent through the hold, so nothing on screen
 * changes unless the answer does; answered, the service worker's and the
 * desktop shell's holds go with the page's. Listings refused, their hold goes,
 * or the look would be refused by it.
 */
export function useAskBucketAgain(): () => void {
  const client = useQueryClient()
  return useCallback(() => {
    const look = (): void => {
      cloudLibrary.markCloudLibraryStale()
      void client.invalidateQueries({ queryKey: queryKeys.library })
    }
    if (bucketRefusals('read') > 0) {
      void cloudSession
        .loadSession()
        .then(session => (session ? cloudLibrary.askBucketRead(session) : false))
        .catch(() => false)
        .then(asked => {
          // Still refused: held for longer, and nothing else is worth asking.
          if (asked && bucketHold('read') !== null) return
          // Answered — or nothing to ask with, and whatever plays next finds out.
          askBucketAgain()
          look()
        })
    } else {
      if (bucketHold('list') !== null) lapseBucketHold('list')
      look()
    }
    if (cloudLibrary.pendingCloudChanges() > 0) void cloudLibrary.flushCloudChanges()
  }, [client])
}
