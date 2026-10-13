import { useSyncExternalStore } from 'react'
import { prefs } from '../../ports/prefs'
import { hasSeen, parseSeen, withSeen, writeSeen, type GuideName, type Seen } from './guide.model'

/**
 * Which guides this device has shown, and which one is showing now.
 *
 * Per device on purpose: a phone teaches holding and swiping, a computer
 * dragging and right-clicking, so what one has learnt says nothing about the
 * other. Kept through `prefs`, which is synchronous, so a screen knows during
 * its first render whether it has a guide to give.
 */

const KEY = 'guides'
const VISITS_KEY = 'guide-visits'

let seen: Seen = parseSeen(prefs.get(KEY))
let showing: GuideName | null = null
const asked = new Set<GuideName>()
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function guideSeen(name: GuideName): boolean {
  return hasSeen(seen, name)
}

/** Remembered the moment it appears (B1): closing the app with it up still counts. */
export function markGuideSeen(name: GuideName): void {
  const next = withSeen(seen, name)
  if (next === seen) return
  seen = next
  prefs.set(KEY, writeSeen(seen))
  changed()
}

/** Settings › About's "Show tips again": every guide comes back, once each. */
export function forgetGuides(): void {
  seen = new Set()
  prefs.set(KEY, '')
  prefs.set(VISITS_KEY, '{}')
  changed()
}

/**
 * One guide on screen at a time. A screen that would show its own while
 * another is up waits for the next time it is ready.
 */
export function claimGuide(name: GuideName): boolean {
  if (showing !== null && showing !== name) return false
  showing = name
  return true
}

export function releaseGuide(name: GuideName): void {
  if (showing === name) {
    showing = null
    changed()
  }
}

/**
 * A guide that something else asks for: the sidebar's, the first time a song
 * goes into a playlist from its ⋯ menu. Asking does nothing once it is seen.
 */
export function askForGuide(name: GuideName): void {
  if (guideSeen(name) || asked.has(name)) return
  asked.add(name)
  changed()
}

export function useGuideAsked(name: GuideName): boolean {
  useSyncExternalStore(subscribe, () => version)
  return asked.has(name)
}

/** Re-renders a caller when a guide is shown, closed, asked for or forgotten. */
export function useGuideMemory(): number {
  return useSyncExternalStore(subscribe, () => version)
}

/**
 * How many times a place has been visited before, counting this visit. Library's
 * guide waits for the second, so the first look at a library is left alone.
 */
export function countVisit(name: GuideName): number {
  let visits: Record<string, number> = {}
  try {
    visits = JSON.parse(prefs.get(VISITS_KEY) ?? '{}') as Record<string, number>
  } catch {
    visits = {}
  }
  const count = (visits[name] ?? 0) + 1
  visits[name] = count
  prefs.set(VISITS_KEY, JSON.stringify(visits))
  return count
}
