import { OfflineScopeSchema, type OfflineScope } from '@selfmp3/shared'
import { CLOUD } from '../lib/platform.js'

/**
 * Automatic downloads: the per-device preferences, and what the connection
 * allows.
 *
 * Offline music is a fact about one device, not about the library, so none of
 * this goes to the server. A phone short on space can keep only playlists
 * while a laptop keeps everything.
 */

export interface OfflinePrefs {
  /** Keep this device's downloads in step with the library without asking. */
  readonly auto: boolean
  /** Only download automatically on Wi-Fi or a cable. */
  readonly wifiOnly: boolean
  /** Everything, or only songs that are in at least one playlist. */
  readonly scope: OfflineScope
}

const PREFS_KEY = 'selfmp3:offline-prefs'
const EXCLUDED_KEY = 'selfmp3:offline-excluded'

/**
 * The browser running on the Mac that serves the library.
 *
 * Its audio is already on this disk, so copying the whole library into the
 * browser's cache as well would double it for nothing.
 */
export function isServerMachine(): boolean {
  // Built for the web, no machine holds the library: it is all in the bucket.
  if (CLOUD) return false
  if (typeof location === 'undefined') return false
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname)
}

/**
 * Where automatic downloads start.
 *
 * Off in a browser reading the bucket. A tab at an address is not a device
 * anyone chose to fill: songs stream from the bucket, the ones actually
 * listened to are kept for a while (recentCache.ts), and copying a library
 * of a thousand songs into a browser is a thing to ask for, not to assume.
 *
 * Off on the Mac too, which has the files already. On for a phone or a laptop
 * reaching the Mac over Tailscale — there, downloading ahead is the whole
 * point: the Mac is not always awake.
 */
export function defaultPrefs(): OfflinePrefs {
  return { auto: !CLOUD && !isServerMachine(), wifiOnly: true, scope: 'library' }
}

export function loadPrefs(): OfflinePrefs {
  const fallback = defaultPrefs()
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return fallback
    const stored = JSON.parse(raw) as Partial<Record<keyof OfflinePrefs, unknown>>
    const scope = OfflineScopeSchema.safeParse(stored.scope)
    return {
      auto: typeof stored.auto === 'boolean' ? stored.auto : fallback.auto,
      wifiOnly: typeof stored.wifiOnly === 'boolean' ? stored.wifiOnly : fallback.wifiOnly,
      scope: scope.success ? scope.data : fallback.scope,
    }
  } catch {
    return fallback
  }
}

export function savePrefs(prefs: OfflinePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Private browsing; the choice lasts for this session.
  }
}

/**
 * Songs taken off this device by hand.
 *
 * Without this list, "Remove download" on one song would last until the next
 * automatic pass put it straight back. Downloading the song again by hand
 * takes it off the list.
 */
export function loadExcluded(): Set<number> {
  try {
    const raw = localStorage.getItem(EXCLUDED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    const ids = Array.isArray(parsed) ? (parsed as unknown[]) : []
    return new Set(ids.filter((id): id is number => Number.isInteger(id)))
  } catch {
    return new Set()
  }
}

export function saveExcluded(ids: ReadonlySet<number>): void {
  try {
    localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...ids]))
  } catch {
    // As above.
  }
}

/**
 * What the current connection allows.
 *
 * - `unmetered`: Wi-Fi or a cable, as far as the browser can tell.
 * - `metered`: cellular, or the user asked the browser to save data.
 * - `unknown`: the browser will not say. Safari never exposes the connection
 *   type, so on an iPhone this is the normal answer — and "only on Wi-Fi"
 *   then means asking before downloading rather than guessing.
 */
export type ConnectionKind = 'unmetered' | 'metered' | 'unknown'

interface NetworkInformationLike extends EventTarget {
  readonly type?: string
  readonly saveData?: boolean
}

function networkInformation(): NetworkInformationLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection
}

export function connectionKind(): ConnectionKind {
  const connection = networkInformation()
  if (connection?.saveData) return 'metered'

  const type = connection?.type
  if (type === 'wifi' || type === 'ethernet') return 'unmetered'
  if (type === 'cellular') return 'metered'

  // Desktop browsers never report a type. A machine with a mouse and hover is
  // on Wi-Fi or a cable in every case that matters; a phone is not assumed to be.
  if (
    type === undefined &&
    typeof window !== 'undefined' &&
    window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  ) {
    return 'unmetered'
  }
  return 'unknown'
}

/** Call `listener` when the connection type changes, where the browser says. */
export function onConnectionChange(listener: () => void): () => void {
  const connection = networkInformation()
  connection?.addEventListener('change', listener)
  return () => connection?.removeEventListener('change', listener)
}
