import type { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@selfmp3/client'

/**
 * What a query that asks the model is set up with: it is asked once, and
 * again only when the person says so (Try again, Write it again).
 *
 * Each ask costs the model, and the same words asked again can come back a
 * different answer. Asked again behind the person's back — an Ask turn kept
 * mounted after it failed, refetched with everything else that failed when the
 * server came back (`refetchFailed`) — a failed "skip this song" turned into a
 * list of sixteen songs half an hour later, and nineteen failed changes were
 * each sent again. So it is not retried, not asked again when the network
 * comes back or a page that shows it mounts again, and passed over by
 * `refetchFailed`: a failed turn stays failed until Try again.
 */
export const ASKS_MODEL = {
  meta: { asksModel: true },
  retry: false,
  retryOnMount: false,
  refetchOnReconnect: false,
} as const

/**
 * Ask again for whatever is on screen and failed for want of an answer: the
 * library, Stats, a playlist's songs. A refusal is an answer (a song with no
 * words, a page that is not there), and asking again would only hear it again;
 * a question to the model is asked again only when the person says so
 * (`ASKS_MODEL`).
 */
export function refetchFailed(client: QueryClient): void {
  void client.refetchQueries({
    type: 'active',
    predicate: ({ state, meta }) =>
      meta?.['asksModel'] !== true &&
      state.status === 'error' &&
      !(state.error instanceof ApiError && !state.error.isUnanswered),
  })
}
