import type { DeviceKind } from '@selfmp3/shared'

/**
 * A browser's name for itself in other devices' lists.
 *
 * Deliberately coarse, a label for a popover and not analytics. The one
 * subtlety is iPadOS, which claims to be a Mac and is told apart by touch.
 */
interface DeviceDescription {
  readonly name: string
  readonly kind: DeviceKind
}

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

  // Order matters: every Chromium browser also says "Chrome", and every WebKit
  // browser also says "Safari".
  let browser = 'Browser'
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\//.test(ua)) browser = 'Opera'
  else if (/Firefox|FxiOS/.test(ua)) browser = 'Firefox'
  else if (/CriOS/.test(ua)) browser = 'Chrome'
  else if (/Chrome\//.test(ua)) browser = 'Chrome'
  else if (/Safari\//.test(ua)) browser = 'Safari'

  return { name: `${platform} · ${browser}`, kind }
}

/**
 * Whether this browser is on a Mac — the one computer the desktop app is built
 * for, so the one that is offered it. iPadOS claims to be a Mac and is told
 * apart by touch, the same rule as above.
 */
export function onMac(userAgent: string, maxTouchPoints = 0): boolean {
  return (
    /Macintosh|Mac OS X/.test(userAgent) &&
    !/iPhone|iPod|iPad/.test(userAgent) &&
    maxTouchPoints <= 1
  )
}
