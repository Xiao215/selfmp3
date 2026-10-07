import { prefs } from './prefs'

/**
 * What every device keeps the same way about who it is: its id and the name
 * it was given, through the `prefs` port. How a fresh id is drawn and what a
 * device is called by default are each platform's (`device.ts`,
 * `device.web.ts`).
 *
 * The id must survive a restart — it is what other devices address commands
 * to — but not a reinstall, where a fresh id simply looks like a new device.
 */

const ID_KEY = 'device.id'
const NAME_KEY = 'device.name'
/** The longest name a device may be given. */
const NAME_LENGTH = 60

/** What to call this device in a sentence: "on this iPad", "tells this phone". */
export type DeviceWord = 'phone' | 'iPad' | 'tablet' | 'computer'

/** This device's id, drawn once from `randomBytes` and kept. */
export function storedDeviceId(randomBytes: (length: number) => Uint8Array): string {
  const stored = prefs.get(ID_KEY)
  if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored
  const fresh = Array.from(randomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('')
  prefs.set(ID_KEY, fresh)
  return fresh
}

/** The name this device was given, or null when it was given none. */
export function storedDeviceName(): string | null {
  const stored = prefs.get(NAME_KEY)?.trim()
  return stored ? stored.slice(0, NAME_LENGTH) : null
}

/** Keep a name for this device; an empty one keeps nothing. The name as kept, or null. */
export function keepDeviceName(name: string): string | null {
  const trimmed = name.trim().slice(0, NAME_LENGTH)
  if (!trimmed) return null
  prefs.set(NAME_KEY, trimmed)
  return trimmed
}
