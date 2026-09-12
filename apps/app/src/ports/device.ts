import { Platform } from 'react-native'
import type { DeviceKind } from '@selfmp3/shared'

import { prefs } from './prefs'

/**
 * Who this device says it is.
 *
 * The web app's `lib/device.ts`, with `localStorage` replaced by the `prefs`
 * port and the user-agent sniffing replaced by the one thing a phone actually
 * knows about itself. The id must survive a restart — it is what other devices
 * address commands to — but not a reinstall, where a fresh id simply looks like
 * a new device.
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
