import { useEffect, useRef } from 'react'

import type { focusNextStop as SameShape, useArrowsBetweenStops as SameHook } from './focusNext'
import { isComposing } from './composing'
import { layerOpen } from './layers'
import { setTabbing } from './tabbing'

const TAB_STOP =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A song row's press target: out of Tab's way, since a song list is one Tab
 * stop that Tab comes into on its own row (`useListKeys`), but a place the
 * arrows go.
 */
const ROW_PRESS = '[data-row-press]'

/** What Tab would reach, in order, within `root`: drawn, and not hidden from a screen reader. */
function stopsIn(root: ParentNode, rows = false): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(rows ? `${TAB_STOP}, ${ROW_PRESS}` : TAB_STOP),
  ].filter(
    stop =>
      (stop.tabIndex >= 0 || (rows && stop.matches(ROW_PRESS))) &&
      stop.getClientRects().length > 0 &&
      !stop.closest('[aria-hidden="true"]'),
  )
}

/**
 * Move focus to the next thing Tab would reach after `from`: the first of a
 * page's results, from its search field, when ↓ is pressed there. True if it
 * moved. A song row counts, though it is not Tab's: a search whose first
 * result is a song, with no "See all" over it, had ↓ go past the song.
 */
export const focusNextStop: typeof SameShape = from => {
  if (!(from instanceof HTMLElement)) return false
  const next = stopsIn(document, true).find(
    stop => from.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING,
  )
  if (!next) return false
  next.focus()
  return true
}

/**
 * ↑ and ↓ between the stops inside the element named `rootId`, as Tab and
 * Shift+Tab: a page's results, whose search field's ↓ comes into them
 * (`focusNextStop`). ↓ there had landed on the first "See all" and stopped,
 * and the songs under it were Tab's alone. A song list moves between its own
 * rows (`useListKeys`), and takes the arrows first; ↑ from the first stop
 * goes to `above`, the field. A song list's rows are stops here, though not
 * Tab's: ↓ from "See all" goes into the songs under it.
 */
export const useArrowsBetweenStops: typeof SameHook = (rootId, above) => {
  const latest = useRef(above)
  useEffect(() => {
    latest.current = above
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (event.defaultPrevented || isComposing(event) || layerOpen()) return
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
      const root = document.getElementById(rootId)
      const from = event.target
      if (!root || !(from instanceof HTMLElement) || !root.contains(from)) return
      // A text field inside keeps its arrows for its own caret.
      if (from instanceof HTMLInputElement || from instanceof HTMLTextAreaElement) return
      const stops = stopsIn(root, true)
      const at = stops.indexOf(from)
      if (at === -1) return
      event.preventDefault()
      if (event.key === 'ArrowUp' && at === 0) {
        latest.current()
        return
      }
      const next = stops[at + (event.key === 'ArrowDown' ? 1 : -1)]
      if (!next) return
      // The keyboard is moving focus: the ring shows, as Tab's does.
      setTabbing(true)
      next.focus({ preventScroll: true })
      next.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rootId])
}
