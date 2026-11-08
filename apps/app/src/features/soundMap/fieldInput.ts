import type { RefObject } from 'react'
import type { View, ViewProps, ViewStyle } from 'react-native'
import { plural } from '@selfmp3/shared'
import type { FieldKey } from './fieldKeys.model'

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

/** What the field says of itself to a screen reader (`fieldAccess`). */
export interface FieldAccess {
  /** How many songs are on the map. */
  readonly songs: number
  /** The song chosen, as it is said: its title and artist. */
  readonly chosen: string | null
  /** A line is being drawn from the song chosen. */
  readonly drawing: boolean
}

/** The keys the field answers while it has focus (fieldInput.web.ts). A phone's screen reader has its actions instead (`fieldAccess`). */
export function useFieldFocus(
  _ref: RefObject<View | null>,
  _on: {
    key: (key: FieldKey, shift: boolean) => boolean
    focus: (keyboard: boolean) => void
    blur: () => void
  },
): void {}

/** A phone's screen reader says the song chosen itself, as the field's value. */
export const SPEAKS_CHOICE = false

/**
 * The field to VoiceOver and TalkBack: one element that is adjusted, as a
 * slider is. A swipe up or down goes from song to song (`readingOrder`), and
 * the song is said as its value; a double tap plays it; an action of its own
 * starts a line there and another ends it, and a scrub stops drawing
 * (`actionKey`).
 */
export function fieldAccess({ songs, chosen, drawing }: FieldAccess): ViewProps {
  return {
    accessible: true,
    accessibilityRole: 'adjustable',
    accessibilityLabel: `Sound map, ${plural(songs, 'song', 'songs')}`,
    accessibilityHint: 'Swipe up or down to go from song to song, and double-tap to play one.',
    accessibilityValue: chosen === null ? undefined : { text: chosen },
    accessibilityActions: [
      { name: 'increment' },
      { name: 'decrement' },
      { name: 'activate' },
      { name: 'draw', label: drawing ? 'End the line here' : 'Start a line here' },
      ...(drawing ? [{ name: 'escape' }] : []),
    ],
  }
}
