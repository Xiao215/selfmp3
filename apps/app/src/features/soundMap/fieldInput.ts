import type { RefObject } from 'react'
import type { View, ViewStyle } from 'react-native'

/** The pointer over the field (fieldInput.web.ts): a hand that moves the map, a crosshair while drawing is armed. */
export function fieldCursor(_armed: boolean): ViewStyle | null {
  return null
}

/** A scroll or a trackpad pinch over the field, at a point of it: each zooms about it. */
export interface FieldWheel {
  /** Up, away from you, is negative and zooms in. */
  readonly dy: number
  /**
   * What sent it: a trackpad pinch, whose small steps zoom quickly; a
   * mouse's wheel, whose notches are a hundred points each and glide; or a
   * trackpad's two fingers, a frame at a time.
   */
  readonly from: 'pinch' | 'notch' | 'scroll'
  readonly x: number
  readonly y: number
}

/**
 * Scrolling over the sound map zooms it, however it scrolls
 * (fieldInput.web.ts). A phone has no wheel: fingers move and zoom it,
 * through the field's own gestures.
 */
export function useFieldWheel(
  _ref: RefObject<View | null>,
  _onWheel: (wheel: FieldWheel) => void,
): void {}

/** Arrow keys held, as a direction to move the map in (fieldInput.web.ts). A phone has no arrows. */
export function useFieldKeys(_onKeys: (direction: { x: number; y: number }) => void): void {}

/** Shift held, which arms drawing on a computer (fieldInput.web.ts). A phone has no Shift. */
export function useShiftHeld(): boolean {
  return false
}

/** The pointer moving over the field, or leaving it (null), for naming the star under it. A phone has no pointer. */
export function useFieldPointer(
  _ref: RefObject<View | null>,
  _onPointer: (point: { x: number; y: number } | null) => void,
): void {}
