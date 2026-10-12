import type { Device } from '@selfmp3/shared'

/**
 * The Devices list in Settings, folded so it reads as one row per device.
 *
 * Every browser that opens self.mp3 gets its own device id, kept in that
 * browser's storage for that address, so the same laptop turns up again under
 * a new id whenever its storage is cleared or it opens the app at another
 * address. Left as it was, the list grew a row for each of those, all called
 * "Mac · Chrome". So devices that are offline and share a name are one row,
 * showing the one seen last; forgetting the row forgets all of them. This
 * device and devices online now are never folded, since those are the rows you
 * act on.
 *
 * Rows come in order: this device, then what is online, then the most recently
 * seen. Which of them wait behind "Show N older" is Settings' call
 * (`splitDevices`).
 */

/** One row: a device, or several offline ones that share a name. */
interface DeviceGroup {
  /** The one seen most recently; its name and "last seen" are the row's. */
  readonly device: Device
  /** Every device the row stands for, to forget them together. */
  readonly ids: readonly string[]
}

export function deviceGroups(
  devices: readonly Device[],
  thisDeviceId: string | null,
): readonly DeviceGroup[] {
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
  return groups
}
