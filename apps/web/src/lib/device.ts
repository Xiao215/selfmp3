import type { DeviceKind } from '@selfmp3/shared'

/**
 * Who this client is.
 *
 * The id is generated once and kept in localStorage — it is what other
 * devices address commands to, so it must survive reloads but does not need
 * to survive clearing site data (a fresh id just looks like a new device).
 * The name is guessed from the user agent and can be edited in Settings.
 */

const ID_KEY = 'selfmp3:device:id'
const NAME_KEY = 'selfmp3:device:name'

export interface DeviceDescription {
  readonly name: string
  readonly kind: DeviceKind
}

export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(ID_KEY)
    if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored
    const fresh = generateId()
    localStorage.setItem(ID_KEY, fresh)
    return fresh
  } catch {
    // Private browsing with storage disabled: a per-session id is the best we can do.
    return generateId()
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('')
}

export function getDeviceName(): string {
  try {
    const stored = localStorage.getItem(NAME_KEY)
    if (stored && stored.trim()) return stored.trim().slice(0, 60)
  } catch {
    // Fall through to the guess.
  }
  return detectDevice().name
}

export function setDeviceName(name: string): string {
  const trimmed = name.trim().slice(0, 60)
  try {
    if (trimmed) localStorage.setItem(NAME_KEY, trimmed)
    else localStorage.removeItem(NAME_KEY)
  } catch {
    // Not worth surfacing.
  }
  return trimmed || detectDevice().name
}

export function detectDevice(): DeviceDescription {
  if (typeof navigator === 'undefined') return { name: 'Device', kind: 'other' }
  return describeUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0)
}

/**
 * Turn a user-agent string into "iPhone · Safari" and a kind.
 *
 * Deliberately coarse: this is a label for a popover, not analytics. The one
 * subtlety is iPadOS, which claims to be a Mac and is told apart by touch.
 */
export function describeUserAgent(userAgent: string, maxTouchPoints = 0): DeviceDescription {
  const ua = userAgent

  let platform = 'Device'
  let kind: DeviceKind = 'other'

  if (/iPhone|iPod/.test(ua)) {
    platform = 'iPhone'
    kind = 'phone'
  } else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) {
    platform = 'iPad'
    kind = 'other'
  } else if (/Android/.test(ua)) {
    platform = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
    kind = /Mobile/.test(ua) ? 'phone' : 'other'
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    platform = 'Mac'
    kind = 'desktop'
  } else if (/Windows/.test(ua)) {
    platform = 'Windows PC'
    kind = 'desktop'
  } else if (/CrOS/.test(ua)) {
    platform = 'Chromebook'
    kind = 'desktop'
  } else if (/Linux/.test(ua)) {
    platform = 'Linux'
    kind = 'desktop'
  }

  // Order matters: every Chromium browser also says "Chrome", and every
  // WebKit browser also says "Safari".
  let browser = 'Browser'
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\//.test(ua)) browser = 'Opera'
  else if (/Firefox|FxiOS/.test(ua)) browser = 'Firefox'
  else if (/CriOS/.test(ua)) browser = 'Chrome'
  else if (/Chrome\//.test(ua)) browser = 'Chrome'
  else if (/Safari\//.test(ua)) browser = 'Safari'

  return { name: `${platform} · ${browser}`, kind }
}
