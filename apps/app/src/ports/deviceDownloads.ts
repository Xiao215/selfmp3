import type { ThrottleState } from '@selfmp3/shared'
import type { DeviceDownloader, DeviceFile } from '@/features/import/deviceImports.model'

/**
 * Downloading a song on this device instead of on the server
 * (docs/features/client-download.md).
 *
 * Not on a phone: a page asks YouTube through the browser extension, and an
 * app has no extension. Every song a phone imports is the server's to fetch,
 * as before.
 */
export function deviceDownloader(): Promise<DeviceDownloader | null> {
  return Promise.resolve(null)
}

export function uploadDeviceFile(): Promise<{ status: number; message: string }> {
  return Promise.reject(new Error('this device does not download songs itself'))
}

/** The budget at YouTube, kept for as long as the app runs: nothing downloads here to spend it. */
let budget: ThrottleState | null = null
export const deviceBudget = {
  get: (): ThrottleState | null => budget,
  save: (state: ThrottleState): void => {
    budget = state
  },
}

export type { DeviceFile }
