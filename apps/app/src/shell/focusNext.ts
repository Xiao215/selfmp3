/**
 * Move focus to the next thing Tab would reach after `from` (`focusNext.web.ts`).
 * A phone has no keyboard focus to move.
 */
export function focusNextStop(_from: unknown): boolean {
  return false
}
