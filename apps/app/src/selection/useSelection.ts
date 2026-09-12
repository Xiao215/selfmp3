import { useCallback, useMemo, useState } from 'react'
import { usePathname } from 'expo-router'
import {
  EMPTY_SELECTION,
  allSelected as everySelected,
  clearSelection,
  clickSelected,
  deselectAll as noneSelected,
  enterSelection,
  pruneSelection,
  selectAllVisible,
  selectionActive,
  toggleSelected,
  type SelectionModifiers,
  type SelectionState,
} from '@selfmp3/client'

import { useEscape } from '../shell/useEscape'

export interface Selection {
  readonly ids: ReadonlySet<number>
  readonly count: number
  /** Checkboxes showing: something selected, or selection mode on. */
  readonly active: boolean
  /** A plain tap toggles rather than plays. */
  readonly mode: boolean
  readonly allSelected: boolean
  has: (id: number) => boolean
  toggle: (id: number) => void
  /** A click on a row. True when it was a selection gesture, not a play. */
  click: (id: number, modifiers: SelectionModifiers) => boolean
  enter: (id?: number) => void
  selectAll: () => void
  deselectAll: () => void
  clear: () => void
}

/**
 * Multi-select over the songs on screen, for the library and a playlist.
 *
 * The rules are `packages/client`'s selection functions. What this adds is
 * what they cannot know: which list is visible, which route this is, and a
 * keyboard's Escape.
 *
 * Two things are derived rather than set in an effect, so nothing renders
 * twice to correct itself. Songs that left the visible list are pruned at
 * read time. A selection made on another route reads as empty, because
 * arriving back at a list still holding a selection made against a view you
 * have since left is how songs get deleted by accident.
 */
export function useSelection(visibleIds: readonly number[]): Selection {
  const pathname = usePathname()
  const [stored, setStored] = useState<{ path: string; state: SelectionState }>({
    path: pathname,
    state: EMPTY_SELECTION,
  })

  const state = useMemo(
    () => (stored.path === pathname ? pruneSelection(stored.state, visibleIds) : EMPTY_SELECTION),
    [stored, pathname, visibleIds],
  )

  /** Apply a rule to what is actually on screen now, on this route. */
  const update = useCallback(
    (rule: (current: SelectionState) => SelectionState): void => {
      setStored(previous => {
        const current =
          previous.path === pathname ? pruneSelection(previous.state, visibleIds) : EMPTY_SELECTION
        const next = rule(current)
        return next === current && previous.path === pathname
          ? previous
          : { path: pathname, state: next }
      })
    },
    [pathname, visibleIds],
  )

  const toggle = useCallback(
    (id: number) => update(current => toggleSelected(current, id)),
    [update],
  )

  const click = useCallback(
    (id: number, modifiers: SelectionModifiers): boolean => {
      const { handled, state: next } = clickSelected(state, id, modifiers, visibleIds)
      update(() => next)
      return handled
    },
    [state, visibleIds, update],
  )

  const enter = useCallback(
    (id?: number) => update(current => enterSelection(current, id)),
    [update],
  )
  const selectAll = useCallback(
    () => update(current => selectAllVisible(current, visibleIds)),
    [update, visibleIds],
  )
  const deselectAll = useCallback(() => update(noneSelected), [update])
  const clear = useCallback(() => update(clearSelection), [update])

  const active = selectionActive(state)
  useEscape(active, clear)

  const has = useCallback((id: number) => state.ids.has(id), [state])

  return useMemo(
    () => ({
      ids: state.ids,
      count: state.ids.size,
      active,
      mode: state.mode,
      allSelected: everySelected(state, visibleIds),
      has,
      toggle,
      click,
      enter,
      selectAll,
      deselectAll,
      clear,
    }),
    [state, active, visibleIds, has, toggle, click, enter, selectAll, deselectAll, clear],
  )
}

/**
 * The modifier keys of a press, where there are any. On the web a press event
 * carries the mouse event's Shift, Cmd and Ctrl; a phone's touch has none of
 * them, and reads as a plain tap.
 */
export function modifiersOf(event: { nativeEvent?: unknown } | undefined): SelectionModifiers {
  const native = (event?.nativeEvent ?? {}) as Partial<Record<keyof SelectionModifiers, unknown>>
  return {
    metaKey: native.metaKey === true,
    ctrlKey: native.ctrlKey === true,
    shiftKey: native.shiftKey === true,
  }
}
