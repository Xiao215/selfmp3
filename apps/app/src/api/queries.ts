/**
 * Query hooks — all of them now `packages/client`'s.
 *
 * Phase 1 of the universal migration merged this file into the web app's, which
 * asked the same questions of the same server and had drifted into answering a
 * few of them differently. The four the phone had to itself went across too, so
 * there is one set rather than two.
 *
 * Two things the phone used to do here are now done once, in
 * `ConnectionProvider`: every key carried the server's address so that switching
 * servers could not show the previous one's library, which is a
 * `queryClient.clear()` on the change instead; and every query was gated on
 * `status === 'ready'`, which is `ClientStateProvider`.
 *
 * The client itself is configured in `./client`, which this re-export pulls in.
 */
import './client'

export * from '@selfmp3/client'
