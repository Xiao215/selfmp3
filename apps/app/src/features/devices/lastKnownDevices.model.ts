import { z } from 'zod'
import { DeviceSchema, type Device } from '@selfmp3/shared'

/**
 * The last device list this device was given, kept so Settings › Devices has
 * something honest to show when the server cannot be reached: the same rows,
 * each marked offline, with a line saying the list is the last one.
 *
 * Only what a row draws is kept — a name, a kind, when it was last seen — and
 * none of the playback state, which is stale the moment it is written.
 */

/** Where the list is kept, in this device's small preferences. */
export const LAST_KNOWN_DEVICES_KEY = 'devices.lastKnown'

/** A row as it is written: the shared device shape, less everything that goes stale. */
const KnownDeviceSchema = DeviceSchema.pick({ id: true, name: true, kind: true, lastSeenAt: true })
type KnownDevice = z.infer<typeof KnownDeviceSchema>

/** What is on disk: the rows, and when the answer came. */
const StoredSchema = z.object({
  savedAt: z.number(),
  devices: z.array(KnownDeviceSchema),
})

/** The rows as one string for `prefs`, with everything that goes stale left off. */
export function serializeKnownDevices(devices: readonly Device[], savedAt: number): string {
  const rows: KnownDevice[] = devices.map(device => ({
    id: device.id,
    name: device.name,
    kind: device.kind,
    lastSeenAt: device.lastSeenAt,
  }))
  return JSON.stringify({ savedAt, devices: rows })
}

/**
 * What was written, or null for nothing, an empty list, or anything that is
 * not what this file writes — a preference from an older build reads as none.
 */
export function parseKnownDevices(
  raw: string | null,
): { savedAt: number; devices: readonly KnownDevice[] } | null {
  if (!raw) return null
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  } catch {
    return null
  }
  const result = StoredSchema.safeParse(stored)
  if (!result.success || result.data.devices.length === 0) return null
  return result.data
}

/** Nothing playing: what a kept row says about playback, since none of it was kept. */
const IDLE: Device['state'] = {
  songId: null,
  position: 0,
  playing: false,
  queueIds: [],
  queueIndex: -1,
  shuffle: false,
  repeat: 'off',
  updatedAt: 0,
}

/**
 * The kept rows as devices the list can draw: all offline, since the server
 * that would say otherwise is exactly what cannot be reached, and idle, so
 * nothing reading them could offer to resume from one.
 */
export function knownAsDevices(known: readonly KnownDevice[]): Device[] {
  return known.map(row => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    lastSeenAt: row.lastSeenAt,
    online: false,
    state: IDLE,
  }))
}
