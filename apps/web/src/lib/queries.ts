/**
 * Server state, handled by TanStack Query.
 *
 * Every hook moved to `packages/client` in phase 1 of the universal migration,
 * because none of them was the browser's: they are the same questions the phone
 * asks, and the two apps had drifted into answering some of them differently.
 * This file stays as the door they came through, so the 60-odd components that
 * import from `lib/queries` did not have to move with them.
 *
 * The client itself is configured in `./api.js`, which this re-export pulls in.
 */
import './api.js'

export * from '@selfmp3/client'
