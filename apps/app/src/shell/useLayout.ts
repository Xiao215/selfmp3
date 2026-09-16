import { useWindowDimensions } from 'react-native'
import { BREAKPOINT } from '@selfmp3/client'

import { finePointer } from '../ports/pointer'

/**
 * Which layout the app is wearing, and the width it was decided from.
 *
 * This is the only place in the app that looks at the width. Everything else
 * asks `wide`, so there is exactly one number to change and no screen has an
 * opinion about what a phone is. `docs/UNIVERSAL.md`, foundation 5: a component
 * is written once with breakpoint variants, not as a phone version and a
 * desktop version.
 *
 * It is a width and not a platform on purpose. A phone in landscape, an iPad,
 * and a browser window dragged narrow all get the layout that fits the room
 * they actually have.
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

export function useLayout(): Layout {
  const { width } = useWindowDimensions()
  const wide = width >= BREAKPOINT
  return { wide, compact: !wide, dense: wide && finePointer, finePointer, width }
}
