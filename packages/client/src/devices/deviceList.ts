import type { Device } from '@selfmp3/shared'

/**
 * The Devices list in Settings, made short enough to read.
 *
 * Every browser that opens self.mp3 gets its own device id, kept in that
 * browser's storage for that address, so the same laptop turns up again under
 * a new id whenever its storage is cleared or it opens the app at another
 * address. Left as it was, the list grew a row for each of those, all called
 * "Mac · Chrome". Three rules keep it useful:
 *
 * - Devices that are offline and share a name are one row, showing the one
 *   seen last; forgetting the row forgets all of them. This device and devices
 *   online now are never folded, since those are the rows you act on.
 * - The list shows this device, what is online, and what was seen in the last
 *   day, up to five rows.
 * - Everything else waits behind "Show N older devices".
 *
 * The server forgets devices a week after they were last seen, so "older" does
 * not grow forever either.
 */

/** One row: a device, or several offline ones that share a name. */
interface DeviceGroup {
  /** The one seen most recently; its name and "last seen" are the row's. */
  readonly device: Device
  /** Every device the row stands for, to forget them together. */
  readonly ids: readonly string[]
}

interface DeviceListView {
  readonly recent: readonly DeviceGroup[]
  readonly older: readonly DeviceGroup[]
}

/** Seen within this long counts as recent. */
const RECENT_DEVICE_MS = 24 * 60 * 60 * 1000
/** Rows shown before "Show N older devices", unless more are online. */
export const RECENT_DEVICE_LIMIT = 5

export function deviceListView(
  devices: readonly Device[],
  thisDeviceId: string | null,
  now: number = Date.now(),
): DeviceListView {
  const pinned = (device: Device): boolean => device.id === thisDeviceId || device.online

  // This device first, then what is online, then the most recently seen.
  const rank = (device: Device): number => (device.id === thisDeviceId ? 0 : device.online ? 1 : 2)
  const sorted = [...devices].sort((a, b) => rank(a) - rank(b) || b.lastSeenAt - a.lastSeenAt)

  const groups: Array<{ device: Device; ids: string[] }> = []
  const byName = new Map<string, { device: Device; ids: string[] }>()
  for (const device of sorted) {
    if (pinned(device)) {
      groups.push({ device, ids: [device.id] })
      continue
    }
    const key = JSON.stringify([device.kind, device.name.trim().toLowerCase()])
    const existing = byName.get(key)
    if (existing) {
      // Sorted newest first, so the row keeps the one already there.
      existing.ids.push(device.id)
      continue
    }
    const group = { device, ids: [device.id] }
    byName.set(key, group)
    groups.push(group)
  }

  const recent: DeviceGroup[] = []
  const older: DeviceGroup[] = []
  for (const group of groups) {
    const { device } = group
    if (pinned(device)) recent.push(group)
    else if (now - device.lastSeenAt <= RECENT_DEVICE_MS && recent.length < RECENT_DEVICE_LIMIT)
      recent.push(group)
    else older.push(group)
  }
  return { recent, older }
}
