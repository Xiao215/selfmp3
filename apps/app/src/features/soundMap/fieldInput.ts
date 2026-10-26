import type { RefObject } from 'react'
import type { View, ViewStyle } from 'react-native'

/** The pointer over the field: a crosshair where there is one (fieldInput.web.ts), as a drag draws. */
export const DRAWING_CURSOR: ViewStyle | null = null

/** A scroll or a trackpad pinch over the field, at a point of it. */
export interface FieldWheel {
  readonly dx: number
  readonly dy: number
  /**
   * Zoom rather than move: a trackpad pinch, whose small steps zoom quickly
   * (`pinch`), or a wheel with ⌘ held, whose notches are a hundred points
   * each and zoom gently.
   */
  readonly zoom: 'pinch' | 'wheel' | null
  readonly x: number
  readonly y: number
}

/**
 * Scrolling over the sound map moves it, and a pinch or ⌘-scroll zooms
 * (fieldInput.web.ts). A phone has no wheel: two fingers move and zoom it,
 * through the field's own gestures.
 */
export function useFieldWheel(
  _ref: RefObject<View | null>,
  _onWheel: (wheel: FieldWheel) => void,
): void {}
