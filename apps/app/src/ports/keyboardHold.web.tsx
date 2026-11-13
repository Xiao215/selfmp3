import type { ReactNode } from 'react'

/**
 * A browser's page change leaves the focus where it was told to go, and a
 * computer's keyboard never moves: there is nothing to keep
 * (`keyboardHold.tsx` is the phone's).
 */
export function holdKeyboard(): void {}

export function releaseKeyboard(): void {}

export function KeyboardHold(): ReactNode {
  return null
}
