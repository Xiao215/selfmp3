import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Multi-select for a list of songs.
 *
 * One hook drives both the library and a playlist, so the two lists cannot
 * drift apart in what a click, a shift-click or Escape means.
 *
 * Four decisions are worth knowing about, because they are the ones that make
 * a selection trustworthy rather than merely present:
 *
 *  1. **The selection is always a subset of what you can see.** `visibleIds`
 *     is the filtered, sorted list on screen; anything that leaves it leaves
 *     the selection with it. A batch action can therefore never touch a song
 *     hidden behind a search box — "remove 40 songs" must mean the forty you
 *     are looking at.
 *  2. **Re-sorting is not a change of contents**, so a selection survives it
 *     untouched. Ranges are resolved against the order at the moment of the
 *     click, which is why `visibleIds` is an order and not a set.
 *  3. **Selection mode is explicit.** A phone has no modifier keys, so the
 *     checkboxes have to be able to come out and stay out. In that mode a
 *     plain tap toggles a row; outside it a plain click still puts the
 *     selection down, exactly as it did before there were any checkboxes.
 *  4. **Escape always gets you out**, from anywhere on the page.
 */

/** The bits of a mouse or keyboard event a selection gesture cares about. */
export interface SelectionModifiers {
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
}

export interface Selection {
  readonly ids: ReadonlySet<number>
  readonly count: number
  /** True while the checkboxes are showing — selected rows or explicit mode. */
  readonly active: boolean
  /** True while a plain tap toggles rather than plays. */
  readonly mode: boolean
  /** Every visible row is selected. */
  readonly allSelected: boolean
  has: (id: number) => boolean
  /** Toggle one row and make it the anchor for the next shift-click. */
  toggle: (id: number) => void
  /**
   * Handle a click on a row. Returns true when the click was a selection
   * gesture and the row should not also do its normal thing (play, open).
   */
  click: (id: number, modifiers: SelectionModifiers) => boolean
  /** Turn the checkboxes on, optionally selecting one row to start from. */
  enter: (id?: number) => void
  selectAll: () => void
  /** Empty the selection but stay in selection mode. */
  deselectAll: () => void
  /** Empty the selection and leave selection mode. */
  clear: () => void
}

const EMPTY: ReadonlySet<number> = new Set()

export function useSelection(visibleIds: readonly number[]): Selection {
  const [ids, setIds] = useState<ReadonlySet<number>>(EMPTY)
  const [mode, setMode] = useState(false)
  /** The row a range extends from: the last one clicked, selected or not. */
  const anchor = useRef<number | null>(null)
  const location = useLocation()

  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds])

  const clear = useCallback((): void => {
    setIds(current => (current.size === 0 ? current : EMPTY))
    setMode(false)
  }, [])

  // Leaving the page ends the selection. Arriving back at a list still holding
  // a selection made against a view you have since navigated away from is the
  // kind of leftover state that gets songs deleted by accident.
  useEffect(() => {
    clear()
  }, [location.pathname, clear])

  // Rule 1: prune to what is visible. This runs on every change of the visible
  // list but allocates nothing unless something actually dropped out, so
  // re-sorting — same ids, new order — costs one set lookup per selected row.
  useEffect(() => {
    setIds(current => {
      if (current.size === 0) return current
      let dropped = false
      const next = new Set<number>()
      for (const id of current) {
        if (visibleSet.has(id)) next.add(id)
        else dropped = true
      }
      return dropped ? next : current
    })
  }, [visibleSet])

  const active = mode || ids.size > 0

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // A menu, dialog or dropdown gets Escape first: it is closing itself,
      // not dismantling the selection underneath it.
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('[role="menu"], [role="dialog"], [role="listbox"], [role="combobox"]')
      ) {
        return
      }
      clear()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, clear])

  const toggle = useCallback((id: number): void => {
    anchor.current = id
    setIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** Everything between the anchor and `id`, in the order now on screen. */
  const rangeTo = useCallback(
    (id: number): number[] => {
      const from = anchor.current
      if (from === null) return [id]
      const start = visibleIds.indexOf(from)
      const end = visibleIds.indexOf(id)
      if (start === -1 || end === -1) return [id]
      const [low, high] = start <= end ? [start, end] : [end, start]
      return visibleIds.slice(low, high + 1)
    },
    [visibleIds],
  )

  const click = useCallback(
    (id: number, modifiers: SelectionModifiers): boolean => {
      if (modifiers.shiftKey) {
        // The anchor stays put, so moving a shift-click up and down the list
        // grows and shrinks one range instead of leaving a trail behind it.
        setIds(new Set(rangeTo(id)))
        return true
      }

      if (modifiers.metaKey || modifiers.ctrlKey) {
        toggle(id)
        return true
      }

      if (mode) {
        toggle(id)
        return true
      }

      // Outside selection mode a plain click puts the selection down — but it
      // still moves the anchor, so shift-clicking a second row means the range
      // between the two, exactly as it does in a file browser.
      anchor.current = id
      setIds(current => (current.size === 0 ? current : EMPTY))
      return false
    },
    [mode, rangeTo, toggle],
  )

  const enter = useCallback(
    (id?: number): void => {
      setMode(true)
      if (id !== undefined) toggle(id)
    },
    [toggle],
  )

  const selectAll = useCallback((): void => {
    setMode(true)
    setIds(new Set(visibleIds))
  }, [visibleIds])

  const deselectAll = useCallback((): void => {
    setIds(current => (current.size === 0 ? current : EMPTY))
  }, [])

  const has = useCallback((id: number) => ids.has(id), [ids])

  const allSelected = visibleIds.length > 0 && ids.size === visibleIds.length

  return useMemo(
    () => ({
      ids,
      count: ids.size,
      active,
      mode,
      allSelected,
      has,
      toggle,
      click,
      enter,
      selectAll,
      deselectAll,
      clear,
    }),
    [ids, active, mode, allSelected, has, toggle, click, enter, selectAll, deselectAll, clear],
  )
}
