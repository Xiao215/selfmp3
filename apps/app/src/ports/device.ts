import { Platform } from 'react-native'
import type { DeviceKind } from '@selfmp3/shared'

import { prefs } from './prefs'

/**
 * Who this device says it is.
 *
 * Uses the `prefs` port instead of `localStorage`, and knows what it is
 * running on directly instead of sniffing the user agent. The id must survive
 * a restart — it is what other devices address commands to — but not a
 * reinstall, where a fresh id simply looks like a new device.
 *
 * A port, and `Platform.OS` is read here because this is the one question that
 * genuinely is about the platform: what kind of thing am I, and what should I
 * be called in somebody else's device list. Everywhere else asks this file
 * rather than the operating system.
 */

const ID_KEY = 'device.id'
const NAME_KEY = 'device.name'

export function getDeviceId(): string {
  const stored = prefs.get(ID_KEY)
  if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored
  const fresh = generateId()
  prefs.set(ID_KEY, fresh)
  return fresh
}

export function getDeviceName(): string {
  return prefs.get(NAME_KEY) ?? defaultName()
}

export function setDeviceName(name: string): string {
  const trimmed = name.trim().slice(0, 60)
  if (trimmed) prefs.set(NAME_KEY, trimmed)
  return trimmed || defaultName()
}

export function deviceKind(): DeviceKind {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? 'phone' : 'desktop'
}

/**
 * Whether removing a song from the library takes this device's copy with it,
 * in one action.
 *
 * On a phone, yes: "delete from library means delete from local too". Asking a
 * second question there — keep it on this phone, or not — offers a state
 * nobody wants, a song on the device that the library has never heard of.
 *
 * A computer keeps its two options, because there they are about a different
 * file: the one in the *server's* library folder, which a rescan would find
 * again. That distinction is real and is not a phone's to make.
 *
 * Here beside `deviceKind` because it is the same question — what kind of
 * thing am I — asked once. A screen asks this file, never `Platform.OS`.
 */
export const removingTakesTheCopy = deviceKind() === 'phone'

/** "iPhone" rather than a user agent: this app knows what it is running on. */
function defaultName(): string {
  if (Platform.OS === 'ios') return 'iPhone'
  if (Platform.OS === 'android') return 'Android'
  return 'self.mp3'
}

function generateId(): string {
  const bytes = new Uint8Array(16)
  // `crypto` is present in Hermes and in every browser this runs in; the
  // fallback is only so a missing one cannot stop the app identifying itself.
  const source = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto
  if (source?.getRandomValues) source.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
