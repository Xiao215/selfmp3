import type { focusNextStop as SameShape } from './focusNext'

const TAB_STOP =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Move focus to the next thing Tab would reach after `from`: the first of a
 * page's results, from its search field, when ↓ is pressed there. True if it
 * moved.
 */
export const focusNextStop: typeof SameShape = from => {
  if (!(from instanceof HTMLElement)) return false
  const stops = [...document.querySelectorAll<HTMLElement>(TAB_STOP)].filter(
    stop =>
      stop.tabIndex >= 0 &&
      stop.getClientRects().length > 0 &&
      !stop.closest('[aria-hidden="true"]'),
  )
  const next = stops.find(
    stop => from.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING,
  )
  if (!next) return false
  next.focus()
  return true
}
