import type { View } from 'react-native'
import type { PopoverAnchor } from './rightClick'

/**
 * Covers flying into the Up next button (docs/features/lists.md, motion):
 * what tells you where the songs went when you played them from somewhere Up
 * next cannot be seen — an answer in Search, a tag's page, a song's menu. It
 * stands in for the "Playing in Up next" toast and for Up next opening by
 * itself, which both said the same thing louder.
 *
 * The button that opens Up next — the mini player's on a phone, the player
 * bar's on a computer — registers itself here; a flight starts from whatever
 * was pressed, measured in the window, and `CoverFlight` draws it over
 * everything. When Up next is already on screen nothing flies: its own rows
 * arriving say it.
 */

interface FlightFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Flight {
  readonly id: number
  readonly from: FlightFrame
  readonly to: FlightFrame
  /** Up to three covers, the first on top; null draws the placeholder. */
  readonly uris: readonly (string | null | undefined)[]
}

const targets = new Set<View>()
let flights: readonly Flight[] = []
/** Flights asked for whose ends are still being measured: on their way, as far as a count can tell. */
let launching = 0
let landings = 0
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeFlights(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const currentFlights = (): readonly Flight[] => flights
/**
 * How many flights are on their way, the ones still being measured
 * included: the songs are queued before their covers can lift, and the Up
 * next button's count waits for them to land.
 */
export const flightsUnderway = (): number => flights.length + launching
/** Counts up each time covers land, so the button can pulse once per landing. */
export const landingCount = (): number => landings

/** The Up next button, while it is drawn; null as it goes. */
export function registerUpNextTarget(node: View | null, previous: View | null): void {
  if (previous) targets.delete(previous)
  if (node) targets.add(node)
}

function measure(node: PopoverAnchor): Promise<FlightFrame | null> {
  return new Promise(resolve => {
    node.measureInWindow((x, y, width, height) =>
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null),
    )
  })
}

/**
 * Send covers from `from` to the Up next button. Quietly nothing when either
 * end cannot be measured, or `upNextShown` says the songs can already be seen
 * arriving.
 */
export function flyToUpNext(
  from: PopoverAnchor | null,
  uris: readonly (string | null | undefined)[],
  upNextShown: boolean,
): void {
  if (upNextShown || !from || uris.length === 0) return
  launching += 1
  emit()
  void (async () => {
    const start = await measure(from)
    const end = start ? await firstTarget() : null
    launching -= 1
    if (start && end) {
      flights = [...flights, { id: nextId++, from: start, to: end, uris: uris.slice(0, 3) }]
    }
    emit()
  })()
}

/** Where covers land: the first Up next button that can be measured, or none. */
async function firstTarget(): Promise<FlightFrame | null> {
  for (const target of targets) {
    const end = await measure(target)
    if (end) return end
  }
  return null
}

/** A flight has landed: it is taken away, and the button is told. */
export function landFlight(id: number): void {
  flights = flights.filter(flight => flight.id !== id)
  landings += 1
  emit()
}
