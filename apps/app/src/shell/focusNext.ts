/**
 * Move focus to the next thing Tab would reach after `from` (`focusNext.web.ts`).
 * A phone has no keyboard focus to move.
 */
export function focusNextStop(_from: unknown): boolean {
  return false
}

/**
 * ↑ and ↓ between the stops inside the element named `rootId`
 * (`focusNext.web.ts`). Nothing to move on a phone.
 */
export function useArrowsBetweenStops(_rootId: string, _above: () => void): void {}
