import { useSyncExternalStore } from 'react'
import { Dimensions, type ScaledSize } from 'react-native'
import { BREAKPOINT } from '@selfmp3/client'

import { finePointer } from '../ports/pointer'
import { createValueStore } from '../state/valueStore.model'
import { readRootWidth, subscribeRootWidth } from './rootWidth'

/**
 * Which layout the app is wearing, and the width it was decided from.
 *
 * This is the only place in the app that looks at the width. Everything else
 * asks `wide`, so there is exactly one number to change and no screen has an
 * opinion about what a phone is. `docs/ARCHITECTURE.md`, foundation 5: a component
 * is written once with breakpoint variants, not as a phone version and a
 * desktop version.
 *
 * It is a width and not a platform on purpose. A phone in landscape, an iPad,
 * an iPad given half the screen in Split View, and a browser window dragged
 * narrow all get the layout that fits the room they actually have.
 */
interface Layout {
  /** At or above the 820-point breakpoint: sidebar, player bar, popovers. */
  wide: boolean
  /** Below it: tab bar, mini player, full-screen now playing, sheets. */
  compact: boolean
  /**
   * Wide, with a mouse: draw controls at desktop size (34–38 points) rather
   * than a finger's 44. A tablet at the same width is not dense, because it
   * is still a finger.
   */
  dense: boolean
  /**
   * A mouse or trackpad, at any width: controls that are actions rather than
   * information may wait for the pointer, as the web's do. A finger never
   * hovers, so on a touch screen they are always shown.
   */
  finePointer: boolean
  width: number
}

/**
 * The window, as `Dimensions` reports it, held in one store with one listener
 * however many components read it. `useWindowDimensions` gives every caller
 * its own listener and a render for every pixel a window is dragged.
 */
const windowSize = createValueStore<ScaledSize>(Dimensions.get('window'))
let listening = false

function subscribeWindow(listener: () => void): () => void {
  if (!listening) {
    listening = true
    Dimensions.addEventListener('change', ({ window }) => windowSize.set(window))
  }
  return windowSize.subscribe(listener)
}

function subscribeWidth(listener: () => void): () => void {
  const stopWindow = subscribeWindow(listener)
  const stopRoot = subscribeRootWidth(listener)
  return () => {
    stopWindow()
    stopRoot()
  }
}

/**
 * The app's own root, where it has been measured: an iPad in Split View is
 * given half the screen, and the window it is told about can still be the
 * whole of it (`rootWidth.ts`).
 */
const readWidth = (): number => readRootWidth() ?? windowSize.get().width

function layoutAt(width: number): Layout {
  const wide = width >= BREAKPOINT
  return { wide, compact: !wide, dense: wide && finePointer, finePointer, width }
}

/**
 * The layout, and a render for every change of width — a window being dragged
 * is one a pixel. For something that draws by the width itself; anything that
 * only asks `wide` or `dense` asks `useLayoutValue`.
 */
export function useLayout(): Layout {
  return layoutAt(useSyncExternalStore(subscribeWidth, readWidth, readWidth))
}

/**
 * One fact about the layout, rendering again only when that fact changes: a
 * row, a button and a sheet ask whether the window is wide or the pointer
 * fine, and a window dragged across the page's width is not a change to
 * either until it crosses the breakpoint. `select` must answer with a value
 * that compares by `===` — a boolean, a number, a string.
 */
export function useLayoutValue<T>(select: (layout: Layout) => T): T {
  const read = (): T => select(layoutAt(readWidth()))
  return useSyncExternalStore(subscribeWidth, read, read)
}

/**
 * One fact about the window — its height, the font scale — rendering again
 * only when that fact changes. `select` answers with a value that compares by
 * `===`, and can answer the same thing (a 0) while nothing needs it, such as
 * a sheet that is closed.
 */
export function useWindowValue<T>(select: (window: ScaledSize) => T): T {
  const read = (): T => select(windowSize.get())
  return useSyncExternalStore(subscribeWindow, read, read)
}
