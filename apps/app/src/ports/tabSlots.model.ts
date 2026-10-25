/**
 * Which of a browser's open tabs is which device.
 *
 * Every tab of one browser reads the same stored device id, so two tabs were
 * one device to the server: its state flipped between them with each
 * heartbeat, and "Play there instead" started the song in both. Each tab
 * holds a numbered slot instead, on a lease it renews while it is open and
 * hands back as it closes. The first slot is the browser's own id, so a person
 * with one tab is the device they always were; a second tab is a second
 * device, under the same id with its number after it.
 *
 * A fresh id per tab would have done the first part, but every tab ever
 * opened would then stay in the device list for a week. Slots come back: the
 * list holds as many of this browser as were ever open at once.
 */

/** One slot's holder, and when it last said it was still there. */
interface SlotLease {
  readonly tab: string
  readonly at: number
}

export type SlotLeases = Readonly<Record<string, SlotLease>>

/**
 * How long a lease lasts without being renewed. A tab renews well inside this;
 * one that closed without handing its slot back (a crash) frees it after this.
 */
export const SLOT_LEASE_MS = 20_000

/** How often a tab renews its lease. */
export const SLOT_RENEW_MS = 5_000

/**
 * The slot this tab takes: the one it had before a reload, when nobody else
 * holds it now, and otherwise the lowest one free. A duplicated tab copies the
 * slot it was made from, and finds it held by the live original.
 */
export function chooseSlot(
  leases: SlotLeases,
  { remembered, tab, now }: { remembered: number | null; tab: string; now: number },
): number {
  const free = (slot: number): boolean => {
    const lease = leases[String(slot)]
    return !lease || lease.tab === tab || now - lease.at > SLOT_LEASE_MS
  }
  if (remembered !== null && remembered >= 0 && free(remembered)) return remembered
  let slot = 0
  while (!free(slot)) slot++
  return slot
}

/** The leases with this tab's renewed, and the long-expired ones let go. */
export function renewLease(
  leases: SlotLeases,
  { slot, tab, now }: { slot: number; tab: string; now: number },
): SlotLeases {
  const next: Record<string, SlotLease> = {}
  for (const [key, lease] of Object.entries(leases)) {
    if (now - lease.at <= SLOT_LEASE_MS) next[key] = lease
  }
  next[String(slot)] = { tab, at: now }
  return next
}

/** The leases with this tab's slot handed back, if it still holds it. */
export function releaseLease(
  leases: SlotLeases,
  { slot, tab }: { slot: number; tab: string },
): SlotLeases {
  if (leases[String(slot)]?.tab !== tab) return leases
  const next = { ...leases }
  delete next[String(slot)]
  return next
}

/** Read stored leases, forgiving anything that is not what was written. */
export function parseLeases(raw: string | null): SlotLeases {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const leases: Record<string, SlotLease> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!/^\d+$/.test(key) || !value || typeof value !== 'object') continue
      const { tab, at } = value as { tab?: unknown; at?: unknown }
      if (typeof tab === 'string' && typeof at === 'number') leases[key] = { tab, at }
    }
    return leases
  } catch {
    return {}
  }
}

/** The device id a slot stands for: the browser's own for the first, numbered after it. */
export function slotDeviceId(base: string, slot: number): string {
  return slot === 0 ? base : `${base}-${slot + 1}`
}

/** The name a slot's device goes by: the browser's, with the tab's number after it. */
export function slotDeviceName(name: string, slot: number): string {
  return slot === 0 ? name : `${name} · tab ${slot + 1}`
}
