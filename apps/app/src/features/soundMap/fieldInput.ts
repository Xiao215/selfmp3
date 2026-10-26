import type { RefObject } from 'react'
import type { View, ViewStyle } from 'react-native'

/** The pointer over the field (fieldInput.web.ts): a hand that moves the map, a crosshair while drawing is armed. */
export function fieldCursor(_armed: boolean): ViewStyle | null {
  return null
}

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
 * (fieldInput.web.ts). A phone has no wheel: fingers move and zoom it,
 * through the field's own gestures.
 */
export function useFieldWheel(
  _ref: RefObject<View | null>,
  _onWheel: (wheel: FieldWheel) => void,
): void {}

/** Shift held, which arms drawing on a computer (fieldInput.web.ts). A phone has no Shift. */
export function useShiftHeld(): boolean {
  return false
}

/** The pointer moving over the field, or leaving it (null), for naming the star under it. A phone has no pointer. */
export function useFieldPointer(
  _ref: RefObject<View | null>,
  _onPointer: (point: { x: number; y: number } | null) => void,
): void {}
