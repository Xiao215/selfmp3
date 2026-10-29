import type { Api } from '@selfmp3/client'
import type { ImportEnqueue, ImportEnqueueResult, ImportPreview } from '@selfmp3/shared'
import {
  deviceBudget,
  deviceDownloader,
  deviceListenUrl,
  uploadDeviceFile,
} from '@/ports/deviceDownloads'
import { DeviceImports } from './deviceImports.model'
import { previewOnDevice, refusing, singleVideo } from './devicePreview.model'
import { deviceDownloadsOn, deviceHandBackOn, watchDeviceDownloads } from './devicePrefs'

/**
 * The one `DeviceImports` this app runs (deviceImports.model.ts): songs this
 * device downloads for its server, wherever the import was started from.
 */
const deviceImports = new DeviceImports({
  downloader: deviceDownloader,
  upload: uploadDeviceFile,
  budget: deviceBudget,
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  every: (ms, tick) => {
    const timer = setInterval(tick, ms)
    return () => clearInterval(timer)
  },
  handBack: deviceHandBackOn,
  wanted: deviceDownloadsOn,
  log: (message, details) => console.warn(`[device import] ${message}`, details ?? ''),
})

// Turned off partway through a batch: the server takes what this browser has not started.
watchDeviceDownloads(() => {
  if (!deviceDownloadsOn()) void deviceImports.letGo('downloading in this browser was turned off')
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
  const youtube = deviceDownloadsOn() ? await deviceDownloader() : null
  // Refused for rate a moment ago, and told to hand back: the server has these.
  const waiting = deviceHandBackOn() && refusing(deviceBudget, Date.now())
  const onDevice = youtube !== null && !waiting && !api.answersFromCloud()
  const result = await api.importEnqueue(onDevice ? { ...request, fetchOnDevice: true } : request)
  if (result.device) deviceImports.take(api, result.device, result.jobs)
  return result
}

/**
 * Look a link up, on this device when it is one YouTube video and the
 * extension answers (devicePreview.model.ts), and by the server otherwise —
 * or when the device could not. The server is told not to look for the rows'
 * audio when this device would be the one listening.
 */
export async function previewImport(api: Api, input: string): Promise<ImportPreview> {
  // Whether this device can ask YouTube at all first: on a phone it cannot, and nothing else is asked.
  const youtube = deviceDownloadsOn() ? await deviceDownloader() : null
  const onDevice = youtube !== null && !api.answersFromCloud()
  const video = onDevice ? singleVideo(input) : null
  if (youtube && video) {
    try {
      return await previewOnDevice(
        {
          youtube,
          alreadyHave: tracks => api.importAlreadyHave(tracks),
          budget: deviceBudget,
          now: () => Date.now(),
        },
        video,
      )
    } catch (error) {
      console.warn('[device import] the server looks this one up instead:', error)
    }
  }
  return onDevice ? api.importPreview(input, { warmListen: false }) : api.importPreview(input)
}

/**
 * Where a review's song plays from: this device's own download when it can
 * make one, else `server` — the server's listen address for it.
 */
export async function listenSource(url: string, server: () => string): Promise<string> {
  if (!deviceDownloadsOn()) return server()
  return (await deviceListenUrl(url)) ?? server()
}
