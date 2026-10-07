import { describeUserAgent } from '@selfmp3/client'
import type { DeviceKind } from '@selfmp3/shared'

import { desktop } from './desktop/bridge'
import { keepDeviceName, storedDeviceId, storedDeviceName, type DeviceWord } from './deviceIdentity'

/**
 * Who this browser says it is.
 *
 * The phone's file knows what it runs on. A browser does not, so its name and
 * kind are read from the user agent ("Mac · Chrome", an iPhone's Safari as a
 * phone). Without this a browser called itself "self.mp3" in every other
 * device's list, and a phone's browser counted as a desktop.
 *
 * The installed app is the case in between: it is this same web build, so the
 * user agent is still Chrome's, but it is not a tab and it knows the machine's
 * real name. "Xiao's MacBook Pro" is what should appear in the app's device
 * list, not "Mac · Chrome" — and it is a different device from the browser on
 * the same Mac, which the separate `app://selfmp3` origin already gives it a
 * separate stored id under.
 */

function described(): { name: string; kind: DeviceKind } {
  if (desktop) return { name: desktop.info.hostname, kind: 'desktop' }
  if (typeof navigator === 'undefined') return { name: 'Device · Browser', kind: 'other' }
  return describeUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0)
}

export function getDeviceId(): string {
  return storedDeviceId(length => crypto.getRandomValues(new Uint8Array(length)))
}

export function getDeviceName(): string {
  return storedDeviceName() ?? described().name
}

export function setDeviceName(name: string): string {
  return keepDeviceName(name) ?? described().name
}

export function deviceKind(): DeviceKind {
  return described().kind
}

/**
 * What to call this device in a sentence. A browser cannot tell a tablet from
 * a computer by name, so the layout and the pointer say it: wide with a mouse
 * is a computer, wide with a finger a tablet, and narrow a phone.
 */
export function deviceWord(layout: { wide: boolean; finePointer: boolean }): DeviceWord {
  if (desktop) return 'computer'
  if (!layout.wide) return 'phone'
  return layout.finePointer ? 'computer' : 'tablet'
}
