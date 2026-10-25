import { describeUserAgent } from '@selfmp3/client'
import type { DeviceKind } from '@selfmp3/shared'

import { desktop } from './desktop/bridge'
import { keepDeviceName, storedDeviceId, storedDeviceName, type DeviceWord } from './deviceIdentity'
import {
  SLOT_RENEW_MS,
  chooseSlot,
  parseLeases,
  releaseLease,
  renewLease,
  slotDeviceId,
  slotDeviceName,
  type SlotLeases,
} from './tabSlots.model'

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

/** Where the open tabs' slots are kept (shared by every tab), and this tab's own (`tabSlots.model`). */
const LEASES_KEY = 'selfmp3.tabSlots'
const SLOT_KEY = 'selfmp3.tabSlot'

/** This page's slot, taken the first time anything asks. */
let slot: number | null = null

function readLeases(): SlotLeases {
  try {
    return parseLeases(window.localStorage.getItem(LEASES_KEY))
  } catch {
    return {}
  }
}

function writeLeases(leases: SlotLeases): void {
  try {
    window.localStorage.setItem(LEASES_KEY, JSON.stringify(leases))
  } catch {
    // Storage refused: every tab is the first, as before.
  }
}

/** Take a slot, and keep it while this page is open. */
function takeSlot(): number {
  if (typeof window === 'undefined') return 0
  const tab = Math.random().toString(36).slice(2)
  let remembered: number | null = null
  try {
    const stored = window.sessionStorage.getItem(SLOT_KEY)
    remembered = stored === null ? null : Number(stored)
  } catch {
    // No session storage: a reload takes the lowest free slot.
  }
  const taken = chooseSlot(readLeases(), { remembered, tab, now: Date.now() })
  const renew = (): void =>
    writeLeases(renewLease(readLeases(), { slot: taken, tab, now: Date.now() }))
  renew()
  try {
    window.sessionStorage.setItem(SLOT_KEY, String(taken))
  } catch {
    // As above.
  }
  setInterval(renew, SLOT_RENEW_MS)
  window.addEventListener('pagehide', () =>
    writeLeases(releaseLease(readLeases(), { slot: taken, tab })),
  )
  // Back from the browser's page cache: still this tab, so still its slot.
  window.addEventListener('pageshow', event => {
    if (event.persisted) renew()
  })
  return taken
}

function tabSlot(): number {
  // The installed app is one window, not a tab of a browser.
  if (desktop) return 0
  slot ??= takeSlot()
  return slot
}

/**
 * The id this tab goes by in presence and handoff: the browser's own for the
 * first tab open, and its own number after it for each other one, so two tabs
 * are two devices rather than one flipping between them.
 */
export function presenceDeviceId(): string {
  return slotDeviceId(getDeviceId(), tabSlot())
}

/** This tab's name in other devices' lists: the browser's, with the tab's number after it. */
export function presenceDeviceName(name: string): string {
  return slotDeviceName(name, tabSlot())
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
 * What this device is, as one plain word for its name in the bucket
 * (`cloudPlatform.deviceKind`). A phone's or a tablet's browser says which;
 * a computer's, and the installed app, are a `browser`.
 */
export function deviceModel(): string {
  if (desktop) return 'browser'
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/iPhone/.test(agent)) return 'iphone'
  if (/iPad/.test(agent)) return 'ipad'
  if (/Android/.test(agent)) return 'android'
  return 'browser'
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
