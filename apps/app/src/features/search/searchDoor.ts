import type { ReactNode } from 'react'
import type { TextInputProps } from 'react-native'
import { createValueStore } from '../../state/valueStore.model'

/**
 * Home's search field and Search, on a phone (A, Xiao 2026-11-11). Press the
 * field and it rises into Search's place at the top while Home fades out
 * from under it. Cancel brings it back down into Home. The two pages pass
 * the move between them here (`useSearchDoor.tsx` is Home's half).
 *
 * Search can't be a transparent page over Home, which is how Now Playing
 * rises: a page opened from inside a modal lands under it. So Home plays the
 * open itself, and Search arrives in the frame where it ends. Going back,
 * Search fades what it found, and Home plays the same move in reverse.
 *
 * The field on its way is drawn over the pages by the shell (`doorFlight`),
 * not inside Home's: a field inside a page loses the keyboard the moment
 * another page is pushed over it, so the keyboard dropped and came back up
 * as Search arrived. Over the pages it keeps the keyboard until Search's own
 * field takes it, once Search has finished arriving.
 */

/** Home's field on its way to Search or back, drawn over every page (`SearchDoorLayer`). */
export const doorFlight = createValueStore<ReactNode>(null)

/** What Home's field says. */
export const DOOR_HINT = 'One song, an artist, a lyric…'

/** What Search's field says before anything is typed. */
export const SEARCH_HINT = 'Songs, tags, artists, lyrics'

/**
 * The keyboard Search's field asks for. Home's rising field asks for the same
 * one, so the keyboard that comes up with it carries straight on into
 * Search's field without changing its keys or its height.
 */
export const SEARCH_KEYBOARD = {
  autoCapitalize: 'none',
  autoCorrect: false,
  spellCheck: false,
  returnKeyType: 'search',
} as const satisfies TextInputProps

/** How long after Home's move Search may still take it as its own arrival. */
const ARRIVAL_MS = 1500

let arrivedAt = 0

/** Home's move has landed and Search is on its way. */
export function markDoorArrival(): void {
  arrivedAt = Date.now()
}

/**
 * Whether this Search was opened by Home's field, asked for once as the page
 * mounts. A Search opened any other way some time later finds nothing.
 */
export function takeDoorArrival(): boolean {
  const fromDoor = Date.now() - arrivedAt < ARRIVAL_MS
  arrivedAt = 0
  return fromDoor
}

interface Door {
  /** Search is up and its field has the focus: Home can put its field back. */
  readonly settle: () => void
  /** Search is going: Home sets its field at the top, to come back down. False if it can't. */
  readonly comeBack: () => boolean
}

let door: Door | null = null

/** Home's field, while Home is mounted. */
export function listenAsDoor(next: Door): () => void {
  door = next
  return () => {
    if (door === next) door = null
  }
}

export function settleDoor(): void {
  door?.settle()
}

/**
 * Search going back down into Home's field. False when there is no field to
 * go into, and then Search simply closes.
 */
export function returnToDoor(): boolean {
  return door?.comeBack() ?? false
}
