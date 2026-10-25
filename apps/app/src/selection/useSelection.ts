import { useCallback, useMemo, useState } from 'react'
import { usePathname } from 'expo-router'
import {
  EMPTY_SELECTION,
  allSelected as everySelected,
  clearSelection,
  clickSelected,
  enterSelection,
  pruneSelection,
  selectAllVisible,
  selectionActive,
  toggleSelected,
  type SelectionModifiers,
  type SelectionState,
} from '@selfmp3/client'

import { useEscape } from '../shell/useEscape'

export interface Selection<Id = number> {
  readonly ids: ReadonlySet<Id>
  readonly count: number
  /** Checkboxes showing: something selected, or selection mode on. */
  readonly active: boolean
  /** A plain tap toggles rather than plays. */
  readonly mode: boolean
  readonly allSelected: boolean
  has: (id: Id) => boolean
  toggle: (id: Id) => void
  /** A click on a row. True when it was a selection gesture, not a play. */
  click: (id: Id, modifiers: SelectionModifiers) => boolean
  enter: (id?: Id) => void
  selectAll: () => void
  clear: () => void
  /**
   * What dragging the row of song `id` carries: every selected song, in the
   * list's order, when it is one of them; otherwise that song alone.
   */
  carried: (id: Id) => readonly Id[]
}

/**
 * Multi-select over the songs on screen, for the library and a playlist.
 *
 * The rules are `packages/client`'s selection functions. What this adds is
 * what they cannot know: which list is visible, which route this is, and a
 * keyboard's Escape.
 *
 * Two things are derived rather than set in an effect. Songs that left the
 * visible list are pruned as the list is read, and stay pruned. A selection
 * made on another route reads as empty, because arriving back at a list
 * still holding a selection made against a view you have since left is how
 * songs get deleted by accident.
 */
export function useSelection<Id = number>(visibleIds: readonly Id[]): Selection<Id> {
  const pathname = usePathname()
  const [stored, setStored] = useState<{ path: string; state: SelectionState<Id> }>({
    path: pathname,
    state: EMPTY_SELECTION,
  })

  const state = useMemo(
    () => (stored.path === pathname ? pruneSelection(stored.state, visibleIds) : EMPTY_SELECTION),
    [stored, pathname, visibleIds],
  )
  // Pruned for good, not only for this render: a song a filter hid had come
  // back ticked once the filter was off, after the bar had said "None
  // selected" over it. Set while rendering, from what this render found.
  if (stored.path === pathname && state !== stored.state) setStored({ path: pathname, state })

  /** Apply a rule to what is actually on screen now, on this route. */
  const update = useCallback(
    (rule: (current: SelectionState<Id>) => SelectionState<Id>): void => {
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

  const toggle = useCallback((id: Id) => update(current => toggleSelected(current, id)), [update])

  const click = useCallback(
    (id: Id, modifiers: SelectionModifiers): boolean => {
      const { handled, state: next } = clickSelected(state, id, modifiers, visibleIds)
      update(() => next)
      return handled
    },
    [state, visibleIds, update],
  )

  const enter = useCallback((id?: Id) => update(current => enterSelection(current, id)), [update])
  const selectAll = useCallback(
    () => update(current => selectAllVisible(current, visibleIds)),
    [update, visibleIds],
  )
  const clear = useCallback(() => update(clearSelection), [update])

  const active = selectionActive(state)
  useEscape(active, clear)

  const has = useCallback((id: Id) => state.ids.has(id), [state])
  const carried = useCallback(
    (id: Id): readonly Id[] =>
      state.ids.has(id) ? visibleIds.filter(each => state.ids.has(each)) : [id],
    [state, visibleIds],
  )

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
      clear,
      carried,
    }),
    [state, active, visibleIds, has, toggle, click, enter, selectAll, clear, carried],
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
