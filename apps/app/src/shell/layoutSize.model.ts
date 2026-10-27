import { createValueStore, type ValueStore } from '../state/valueStore.model'

/** A width and a height, in points. */
export interface Size {
  readonly width: number
  readonly height: number
}

const sameSize = (a: Size, b: Size): boolean => a.width === b.width && a.height === b.height

const rounded = ({ width, height }: Size): Size => ({
  width: Math.round(width),
  height: Math.round(height),
})

/**
 * The size the app lays out by, from the two things that tell it: the window,
 * as `Dimensions` reports it, and the app's own root view, measured.
 *
 * Neither will do alone. `Dimensions` has been seen not to change on an iPad's
 * first entry into Split View (facebook/react-native #28935): the app is given
 * half the screen and goes on laying out for the whole of it, the computer's
 * sidebar and player bar drawn into a phone's width. The root's `onLayout`
 * always reports the truth, but late: turned on its side, an iPad's window
 * said 1210 × 834 more than a second before the root measured 1210.
 *
 * And the two must not be mixed. The width was the root's and the shape the
 * window's, so for that second the iPad was a landscape window 834 points
 * wide: the computer's layout squeezed into a portrait width, a tag's name
 * one letter to a line beside its cover — and turned back upright, the
 * landscape layout for a moment in portrait (bug bash r1 m43, R2-m17). So the
 * size is whichever of the two last told of a new one, width and height
 * together. A window report that only changes the text size is not a new
 * size: in Split View it would put back the whole screen's width the root
 * had corrected.
 *
 * Pure, so vitest runs it: `useLayout` holds the app's one.
 */
export function createLayoutSize(window: Size): {
  readonly size: ValueStore<Size>
  /** The window, as `Dimensions` reported it. */
  window(next: Size): void
  /** The root view, as its `onLayout` measured it. */
  root(next: Size): void
} {
  let lastWindow = rounded(window)
  const size = createValueStore<Size>(lastWindow, sameSize)
  return {
    size,
    window(next) {
      const now = rounded(next)
      if (sameSize(now, lastWindow)) return
      lastWindow = now
      size.set(now)
    },
    root(next) {
      const now = rounded(next)
      // Zero happens while a view is being laid out; it is not a size.
      if (now.width > 0 && now.height > 0) size.set(now)
    },
  }
}
