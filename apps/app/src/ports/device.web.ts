import { describeUserAgent } from '@selfmp3/client'
import type { DeviceKind } from '@selfmp3/shared'

import { prefs } from './prefs'

/**
 * Who this browser says it is: the web app's `lib/device.ts`.
 *
 * The phone's file knows what it runs on. A browser does not, so its name and
 * kind are read from the user agent ("Mac · Chrome", an iPhone's Safari as a
 * phone), as the web app did. Without this a browser called itself "self.mp3"
 * in every other device's list, and a phone's browser counted as a desktop.
 */

const ID_KEY = 'device.id'
const NAME_KEY = 'device.name'

function described(): { name: string; kind: DeviceKind } {
  if (typeof navigator === 'undefined') return { name: 'Device · Browser', kind: 'other' }
  return describeUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0)
}

export function getDeviceId(): string {
  const stored = prefs.get(ID_KEY)
  if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored
  const fresh = generateId()
  prefs.set(ID_KEY, fresh)
  return fresh
}

export function getDeviceName(): string {
  const stored = prefs.get(NAME_KEY)?.trim()
  return stored ? stored.slice(0, 60) : described().name
}

export function setDeviceName(name: string): string {
  const trimmed = name.trim().slice(0, 60)
  if (trimmed) prefs.set(NAME_KEY, trimmed)
  return trimmed || described().name
}

export function deviceKind(): DeviceKind {
  return described().kind
}

function generateId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
