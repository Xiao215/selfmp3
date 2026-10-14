import type { Api } from '@selfmp3/client'
import type { ImportEnqueue, ImportEnqueueResult } from '@selfmp3/shared'
import { deviceBudget, deviceDownloader, uploadDeviceFile } from '@/ports/deviceDownloads'
import { DeviceImports } from './deviceImports.model'

/**
 * The one `DeviceImports` this app runs (deviceImports.model.ts): songs this
 * device downloads for its server, wherever the import was started from.
 */
export const deviceImports = new DeviceImports({
  downloader: deviceDownloader,
  upload: uploadDeviceFile,
  budget: deviceBudget,
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  every: (ms, tick) => {
    const timer = setInterval(tick, ms)
    return () => clearInterval(timer)
  },
  log: (message, details) => console.warn(`[device import] ${message}`, details ?? ''),
})

/**
 * Queue an import, with this device downloading its YouTube songs when it
 * can (docs/features/client-download.md): only when a server answers — the
 * file has to go to one — and the extension carries this tab's requests to
 * YouTube. Anything else is imported as it always was, by the server.
 */
export async function enqueueImport(
  api: Api,
  request: ImportEnqueue,
): Promise<ImportEnqueueResult> {
  // Whether this device can download at all first: on a phone it cannot, and nothing else is asked.
  const onDevice = (await deviceDownloader()) !== null && !api.answersFromCloud()
  const result = await api.importEnqueue(onDevice ? { ...request, fetchOnDevice: true } : request)
  if (result.device) deviceImports.take(api, result.device, result.jobs)
  return result
}
