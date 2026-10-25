/**
 * When a device downloads, what it says about it, and when a song cannot play.
 *
 * The design in docs/features/offline-sync.md, written once for every client
 * that keeps songs: the phone and the desktop. A browser always streams, so
 * for it most of this answers "nothing to do".
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
 * computer treats every connection as Wi-Fi. A phone on a personal hotspot
 * reports Wi-Fi, and is treated as Wi-Fi.
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
  /**
   * The bucket refusing reads for the day, for a library read from it: every
   * download would be refused, so none is started until the hold lifts —
   * each start would ask once more, and fail once more.
   */
  readonly held: boolean
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
    !situation.held &&
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
      /** Why it is not downloading on its own, for now. */
      readonly reason: 'offline' | 'held' | 'data'
    }

/**
 * The one line above the library, while there is news: a run, a failure, or a
 * wait that will end by itself (offline, the cap, mobile data).
 *
 * A wait only a tap ends — automatic downloads off, or more than 500 MB — says
 * nothing here: it would be the same line on every visit to Library (AL1,
 * 2026-10-25). Library's ⋯ has "Download all", and Settings › On this phone
 * the totals.
 */
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
  const waiting = (reason: 'offline' | 'held' | 'data'): SyncHeader => ({
    kind: 'waiting',
    missing: situation.missing,
    reason,
  })
  if (situation.network === 'none') return waiting('offline')
  if (situation.held) return waiting('held')
  if (situation.autoOnWifi && !onWifi(situation.network)) return waiting('data')
  // On Wi-Fi with the setting on it is about to start by itself; otherwise it
  // waits for a tap, which is no news.
  return { kind: 'none' }
}

/** The header in words: what it says, and the one thing it offers. */
export function syncHeaderText(
  header: SyncHeader,
  /** Where this device keeps songs: "40 not on this phone". */
  place: 'phone' | 'computer' | 'browser',
): { text: string; action: string | null } {
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
      const lead = `${header.missing} not on this ${place}`
      switch (header.reason) {
        case 'offline':
          return { text: `${lead} · offline`, action: null }
        case 'held':
          return { text: `${lead} · storage limit reached for today`, action: null }
        case 'data':
          return { text: `${lead} · on data`, action: 'Download' }
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
export type PlayBlock = 'offline' | 'held' | 'streaming-off' | 'data'

export function playBlock({
  downloaded,
  installed,
  network,
  streamUndownloaded,
  fromCloud,
  bucketHeld,
  dataAllowed,
}: {
  /** A file here already: a download, or a copy kept because it was played. */
  downloaded: boolean
  installed: boolean
  network: NetworkKind
  /** "Play songs that aren't downloaded". */
  streamUndownloaded: boolean
  /**
   * A library read from the cloud. Every platform can play one of its songs
   * without having it first, since what plays can be given the doorman's
   * bearer header: a tab's service worker attaches it, a phone's player sends
   * it with each track, and the desktop shell adds it in its main process.
   */
  fromCloud: boolean
  /**
   * The bucket refusing reads for the day (replica's `bucketHold`). A song not
   * on this device would be refused too: tried anyway, it fails, is retried
   * and skipped, and three of those stop the music however many downloaded
   * songs come after. A browser too: what its service worker kept of the
   * songs it played counts as `downloaded`, and nothing else can come.
   */
  bucketHeld: boolean
  dataAllowed: boolean
}): PlayBlock | null {
  if (downloaded) return null
  if (network === 'none') return 'offline'
  if (fromCloud && bucketHeld) return 'held'
  if (!installed) return null
  if (!streamUndownloaded) return 'streaming-off'
  if (network === 'cellular' && !dataAllowed) return 'data'
  return null
}
