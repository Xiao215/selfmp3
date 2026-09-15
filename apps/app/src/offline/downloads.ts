import { DownloadQueue, type DownloadQueueState } from '@selfmp3/client'

import { downloadStorage } from '../ports/downloadStorage'

/**
 * Keeping songs on this device.
 *
 * The policy — one song at a time, in order, stoppable — is `DownloadQueue` in
 * `packages/client`, with tests. The only difference left between the
 * platforms is where the bytes go: `ports/downloadStorage.ts` on a phone,
 * `ports/downloadStorage.web.ts` in a browser, chosen by Metro. Every screen
 * keeps the same names it had.
 */

export { DownloadQueue }
export type DownloadState = DownloadQueueState

/** One queue for the whole app; downloads must outlive any single screen. */
export const downloadQueue = new DownloadQueue(downloadStorage, {
  // A failed song is tried again after a wait, before it counts as failed.
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
})
