import { formatBytes } from '@selfmp3/shared'

/**
 * When a device downloads, what it says about it, and when a song cannot play.
 *
 * The design Xiao chose on 2026-09-12 (docs/features/offline-sync.md), written
 * once for every client that keeps songs: the phone and the desktop. A browser
 * always streams, so for it most of this answers
 * "nothing to do".
 *
 * Nothing here knows how the network is detected or where bytes go. It is
 * handed the situation and returns a decision, which is what makes it testable.
 */

/** What a device is connected through. `unknown` is a simulator, a VPN, or a Mac. */
export type NetworkKind = 'wifi' | 'cellular' | 'none' | 'unknown'

/** Any sync bigger than this waits for a tap, on any connection. */
export const LARGE_SYNC_BYTES = 500 * 1024 * 1024

/**
 * Wi-Fi, for downloading's purposes. A connection the device cannot name counts:
 * refusing to download on a desk is worse than the data it might cost, and a
 * Mac treats every connection as Wi-Fi (decided the same day). A phone on a
 * personal hotspot reports Wi-Fi, and is treated as Wi-Fi.
 */
export function onWifi(network: NetworkKind): boolean {
  return network === 'wifi' || network === 'unknown'
}

/** The asked-once answer to "on mobile data?", which lasts until Wi-Fi comes back. */
export function dataAnswer(allowed: boolean, network: NetworkKind): boolean {
  return onWifi(network) ? false : allowed
}

export interface SyncSituation {
  /** An installed app that keeps songs; false in a browser, which streams. */
  readonly installed: boolean
  readonly network: NetworkKind
  /** "Download automatically on Wi-Fi". */
  readonly autoOnWifi: boolean
  /** Not on this device, and not removed by hand. */
  readonly missing: number
  readonly missingBytes: number
  /** Songs left in the queue, the one in flight included. */
  readonly queued: number
  /** Songs in the current run, for "12 of 40". */
  readonly batchTotal: number
  readonly paused: boolean
  readonly error: string | null
}

/**
 * Whether to start downloading unasked: an installed app, with the setting on,
 * on Wi-Fi, with something missing, nothing already running, no failure
 * waiting to be seen, and a total small enough not to need a tap.
 */
export function shouldAutoDownload(situation: SyncSituation): boolean {
  return (
    situation.installed &&
    situation.autoOnWifi &&
    onWifi(situation.network) &&
    situation.missing > 0 &&
    situation.queued === 0 &&
    !situation.paused &&
    situation.error === null &&
    situation.missingBytes <= LARGE_SYNC_BYTES
  )
}

type SyncHeader =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'downloading'
      readonly done: number
      readonly total: number
      readonly paused: boolean
    }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'waiting'
      readonly missing: number
      readonly bytes: number
      /** Why it is not downloading on its own. */
      readonly reason: 'offline' | 'data' | 'large' | 'manual'
    }

/** The one line above the library. */
export function syncHeader(situation: SyncSituation): SyncHeader {
  if (situation.queued > 0) {
    const total = Math.max(situation.batchTotal, situation.queued)
    return {
      kind: 'downloading',
      done: total - situation.queued + 1,
      total,
      paused: situation.paused,
    }
  }
  if (situation.error !== null) return { kind: 'error', message: situation.error }
  // A browser streams: a song it has not kept is not a problem to report.
  if (!situation.installed || situation.missing === 0) return { kind: 'none' }
  const waiting = (reason: 'offline' | 'data' | 'large' | 'manual'): SyncHeader => ({
    kind: 'waiting',
    missing: situation.missing,
    bytes: situation.missingBytes,
    reason,
  })
  if (situation.network === 'none') return waiting('offline')
  if (situation.missingBytes > LARGE_SYNC_BYTES) return waiting('large')
  if (!onWifi(situation.network)) return waiting('data')
  if (!situation.autoOnWifi) return waiting('manual')
  // On Wi-Fi with the setting on: it is about to start by itself.
  return { kind: 'none' }
}

/** The header in words: what it says, and the one thing it offers. */
export function syncHeaderText(header: SyncHeader): { text: string; action: string | null } {
  switch (header.kind) {
    case 'none':
      return { text: '', action: null }
    case 'downloading':
      return {
        text: `${header.paused ? 'Paused at' : 'Downloading'} ${header.done} of ${header.total}`,
        action: header.paused ? 'Resume' : 'Pause',
      }
    case 'error':
      return { text: header.message, action: 'Retry' }
    case 'waiting': {
      const lead = `${header.missing} not downloaded`
      switch (header.reason) {
        case 'offline':
          return { text: `${lead} · offline`, action: null }
        case 'data':
          return { text: `${lead} · on data`, action: 'Download' }
        case 'large':
          return { text: `${lead} · ${formatBytes(header.bytes)}`, action: 'Download' }
        case 'manual':
          return { text: lead, action: 'Download' }
      }
    }
  }
}

/** What to ask before a download someone tapped for: nothing, data, size, or both. */
export type DownloadAsk = 'none' | 'data' | 'large' | 'data-large'

export function downloadAsk(
  network: NetworkKind,
  dataAllowed: boolean,
  bytes: number,
): DownloadAsk {
  const large = bytes > LARGE_SYNC_BYTES
  const data = network === 'cellular' && !dataAllowed
  if (large && data) return 'data-large'
  if (large) return 'large'
  if (data) return 'data'
  return 'none'
}

/** Why a song cannot start here, or null when it can. */
export type PlayBlock = 'cloud' | 'offline' | 'streaming-off' | 'data'

export function playBlock({
  downloaded,
  installed,
  network,
  streamUndownloaded,
  fromCloud,
  bucketStreams,
  dataAllowed,
}: {
  /** A file here already: a download, or a copy kept because it was played. */
  downloaded: boolean
  installed: boolean
  network: NetworkKind
  /** "Play songs that aren't downloaded". */
  streamUndownloaded: boolean
  /** A library read from the cloud. */
  fromCloud: boolean
  /**
   * Whether this platform can play a bucket song without having it first.
   *
   * The doorman reads a bearer header and nothing else, so the question is
   * only ever whether the thing that plays can be given one. A browser's
   * service worker attaches it, and so does a phone's player, which takes
   * headers with each track. The desktop shell's `<audio>` element has neither,
   * so there a cloud song still has to arrive before it plays.
   */
  bucketStreams: boolean
  dataAllowed: boolean
}): PlayBlock | null {
  if (downloaded) return null
  if (fromCloud && installed && !bucketStreams) return 'cloud'
  if (network === 'none') return 'offline'
  if (!installed) return null
  if (!streamUndownloaded) return 'streaming-off'
  if (network === 'cellular' && !dataAllowed) return 'data'
  return null
}
