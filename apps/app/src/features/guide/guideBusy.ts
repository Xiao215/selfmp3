import { layerCount, subscribeLayers } from '../../shell/layers'

/**
 * Whether the hands are busy, which a first-run guide waits out.
 *
 * A guide darkens the whole screen and takes the next tap for itself. Arriving
 * while a finger was already down, it came up over a row being held, a song
 * being carried in the rail, or the tag editor a hold had just opened, and the
 * same finger letting go closed it or skipped its first step unread. Arriving
 * while a field had the keys, the typing went on under it. Arriving over a song
 * menu, it lit a row the menu had dimmed. So a guide waits while any of these
 * is so, and comes once it has all been still for a moment (`useGuide`):
 *
 * - a finger or a button is down anywhere (`watchBusy`, at the root);
 * - something has said it is mid-gesture, for the gestures the platform takes
 *   from React's touches once they win (`holdGuides`: a hold to move);
 * - a text field has the keys (`watchBusy`);
 * - a layer is open over the guide's own screen (`shell/layers`).
 *
 * Outside React, as the guides' own memory is: what says so (the root, a row)
 * and what waits (a screen) are not each other's parents.
 */

const holds = new Set<string>()
let fingers = 0
let typing = false
const listeners = new Set<() => void>()

function changed(): void {
  for (const listener of listeners) listener()
}

/** A gesture under way, by a name of the caller's, or over. */
export function holdGuides(reason: string, on: boolean): void {
  if (on === holds.has(reason)) return
  if (on) holds.add(reason)
  else holds.delete(reason)
  changed()
}

/** How many fingers (or buttons) are down now. */
export function setFingers(count: number): void {
  const next = Math.max(0, count)
  if (next === fingers) return
  fingers = next
  changed()
}

/** Whether a text field has the keys now. */
export function setTyping(on: boolean): void {
  if (on === typing) return
  typing = on
  changed()
}

/**
 * Whether a guide on a screen that is itself `ownLayers` layers deep (Up next's
 * sheet is one) has to wait.
 */
export function guidesWait(ownLayers = 0): boolean {
  return holds.size > 0 || fingers > 0 || typing || layerCount() > ownLayers
}

export function subscribeBusy(listener: () => void): () => void {
  listeners.add(listener)
  const unsubscribeLayers = subscribeLayers(listener)
  return () => {
    listeners.delete(listener)
    unsubscribeLayers()
  }
}
