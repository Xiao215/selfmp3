/**
 * Where a thing was drawn a moment before the page it opens arrived, so the
 * page's own copy of it can start there and grow into its place: a song's
 * cover into Now Playing (docs/ui-mock `M2`, 1 and `M3`, 2), a Home tile into
 * a tag's head (`M2`, 2). A stand-in for the shared element the app does not
 * have.
 *
 * The mini player, the player bar and a tile measure themselves in the window
 * and hand the frame over before they push the route; the page takes it on
 * its first render, and finds nothing when it was opened some other way (a
 * lock-screen tap, an address, Back), in which case the thing simply grows in
 * place or is simply there.
 */
export interface CoverFrame {
  /** The cover's top-left corner, in window points. */
  readonly x: number
  readonly y: number
  /** Its side; covers are square. */
  readonly size: number
}

let handed: CoverFrame | null = null

export function handOffCover(frame: CoverFrame): void {
  handed = frame
}

/** The frame handed over, once: the next caller finds nothing. */
export function takeCoverHandoff(): CoverFrame | null {
  const frame = handed
  handed = null
  return frame
}

/** A tile's frame in the window, handed to the place page it opens. */
interface PlaceFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

let handedPlace: PlaceFrame | null = null

export function handOffPlace(frame: PlaceFrame): void {
  handedPlace = frame
}

/** The tile's frame handed over, once. */
export function takePlaceHandoff(): PlaceFrame | null {
  const frame = handedPlace
  handedPlace = null
  return frame
}
