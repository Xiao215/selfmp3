import { DownloadQueue, type DownloadQueueState } from '@selfmp3/client'

import { downloadStorage } from '../ports/downloadStorage'

/**
 * Keeping songs on this device.
 *
 * This file used to be the phone's whole download queue, and a second copy of
 * it lived in `downloads.web.ts`. The policy both wrote — one song at a time,
 * in order, stoppable — is now `DownloadQueue` in `packages/client`, with tests,
 * and the only difference left between the platforms is where the bytes go:
 * `ports/downloadStorage.ts` on a phone, `ports/downloadStorage.web.ts` in a
 * browser, chosen by Metro. Every screen keeps the same names it had.
 */

export { DownloadQueue }
export type DownloadState = DownloadQueueState

/** One queue for the whole app; downloads must outlive any single screen. */
export const downloadQueue = new DownloadQueue(downloadStorage)
