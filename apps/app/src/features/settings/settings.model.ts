import type { DeviceKind, Health, ScanResult } from '@selfmp3/shared'
import { bucketCapped, unreachableLabel, untilCapResets } from '../library/library.model'

/**
 * Settings' rules, with nothing drawn: its pages, crossfade's steps, and the
 * short phrases the rows are made of.
 */

/** Which destructive action is waiting to be confirmed, if any. */
export type Confirming = 'remove-downloads' | 'sign-out' | 'forget-storage' | null

/** Settings' own pages, under the one page (B, 2026-10-26). */
export const ACCOUNT_ROUTE = '/settings/account'
export const ADVANCED_ROUTE = '/settings/advanced'
export const REMEMBERED_ROUTE = '/settings/remembered'

/**
 * Crossfade's steps (C4a): a handful of lengths worth telling apart, rather
 * than a slider whose every second sounds the same as the next. A length kept
 * from before that is not one of them shows as the nearest.
 */
export const CROSSFADE_STEPS = [0, 2, 4, 6, 10] as const

export function nearestStep(seconds: number): (typeof CROSSFADE_STEPS)[number] {
  return CROSSFADE_STEPS.reduce((best, step) =>
    Math.abs(step - seconds) < Math.abs(best - seconds) ? step : best,
  )
}

/**
 * Where this device keeps songs, as the words for it: a phone, an iPad, a
 * computer, or a browser. From the device port's own answer (`ports/device`),
 * which the Devices list uses too, so an installed app is called the same
 * thing in both places: the desktop app is a computer, and everything native
 * a phone, but an iPad is called an iPad, as the Library's line beside it
 * says (`deviceWord`). A tab is a browser on any device: what it has, it
 * keeps in the browser's own storage, and a song there is not on the computer
 * it runs on (`ports/place.ts`, `thisPlace`).
 */
export type DevicePlace = 'phone' | 'iPad' | 'computer' | 'browser'

export function devicePlace(kind: DeviceKind, installed: boolean, iPad = false): DevicePlace {
  if (!installed) return 'browser'
  if (kind !== 'phone') return 'computer'
  return iPad ? 'iPad' : 'phone'
}

/** "On this phone", "On this iPad", "On this computer", "On this browser": what this device keeps. */
export function onThisDevice(place: DevicePlace): string {
  return `On this ${place}`
}

export const crossfadeLabel = (seconds: number): string => (seconds === 0 ? 'Off' : `${seconds}s`)

/**
 * The line under the title, only when something needs you: the library out
 * of reach, or the storage's allowance used up. A library that answered has
 * nothing to say there (the version is in About, E1 2026-10-25), and neither
 * has the check while it is out: the phone said "not connected" for the
 * second it took to ask, with a song playing from the very server it claimed
 * not to reach.
 */
export function healthLine(
  health: Health | undefined,
  asking: {
    readonly loading?: boolean
    /** What the check failed with; any truthy value counts as failed. */
    readonly error?: unknown
    /**
     * The bucket refusing for the day. Said over a health that answered: in the
     * cloud the health is the doorman's, and the doorman answers while the
     * bucket behind it will not.
     */
    readonly capped?: boolean
    /** A phone's line, right-aligned under the title, with less room. */
    readonly compact?: boolean
    readonly now?: Date
  } = {},
): string | null {
  if (asking.capped || bucketCapped(asking.error)) {
    const now = asking.now ?? new Date()
    return asking.compact
      ? `Storage allowance used up · ${untilCapResets(now, true)} left`
      : `Storage allowance used up · resets in about ${untilCapResets(now)}`
  }
  if (health || asking.loading) return null
  if (asking.error) return unreachableLabel(asking.error)
  return 'Not connected to your library right now'
}

/** How long a device counts as one you still use: a week. */
export const RECENT_DEVICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Settings' device rows, split: this device, anything online, and anything
 * seen in the last week, one row each; everything else is the stale sessions
 * a browser leaves behind, said as one "N old sign-ins" row with Clear
 * (E1, 2026-10-25). That is the rest of a name's folded copies too: of 76
 * "Mac · Chrome" rows only the newest is a device still in use.
 *
 * Takes the rows already folded by name (`deviceGroups`) and in their order,
 * which is this device, then online, then most recently seen — so the rows
 * kept keep that order.
 */
export function splitDevices<
  T extends {
    readonly device: { readonly id: string; readonly online: boolean; readonly lastSeenAt: number }
    readonly ids: readonly string[]
  },
>(
  rows: readonly T[],
  thisDeviceId: string | null,
  now: number,
  windowMs: number = RECENT_DEVICE_WINDOW_MS,
): { recent: T[]; olderIds: string[] } {
  const recent: T[] = []
  const olderIds: string[] = []
  for (const row of rows) {
    const { device } = row
    if (device.id === thisDeviceId || device.online || now - device.lastSeenAt <= windowMs) {
      recent.push({ ...row, ids: [device.id] })
      olderIds.push(...row.ids.filter(id => id !== device.id))
    } else olderIds.push(...row.ids)
  }
  return { recent, olderIds }
}

export function scanHint(result: ScanResult | undefined): string {
  if (!result) return 'Picks up files added to the folder by hand.'
  return `Last scan: ${result.added} new, ${result.updated} updated.`
}

/**
 * The line under "self.mp3 for Mac" in a browser tab: what is on offer and,
 * where the browser could not say which Mac this is, how to tell — the two
 * dmgs are named for the chip, and the Intel one runs on an M1 under Rosetta
 * without a word.
 */
export function downloadHint(state: {
  readonly loading: boolean
  readonly error: boolean
  readonly version: string | null
  readonly offers: number
  readonly chip: 'arm64' | 'x64' | null
}): string {
  if (state.loading) return 'Finding the latest version…'
  if (state.error) return 'Couldn’t reach GitHub. Try the releases page.'
  if (state.offers === 0) return 'No release yet.'
  const version = state.version ? `Version ${state.version}. ` : ''
  // Which dmg is this Mac's, where the browser could not tell.
  const which = state.chip ? 'Media keys and a Dock icon.' : 'About This Mac names your chip.'
  return `${version}${which}`
}
