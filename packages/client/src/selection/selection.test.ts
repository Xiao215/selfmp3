import { describe, expect, it } from 'vitest'

import {
  EMPTY_SELECTION,
  allSelected,
  clearSelection,
  clickSelected,
  deselectAll,
  enterSelection,
  pruneSelection,
  selectAllVisible,
  selectionActive,
  toggleSelected,
  type SelectionModifiers,
} from './selection.js'

const PLAIN: SelectionModifiers = { metaKey: false, ctrlKey: false, shiftKey: false }
const SHIFT: SelectionModifiers = { ...PLAIN, shiftKey: true }
const META: SelectionModifiers = { ...PLAIN, metaKey: true }
const CTRL: SelectionModifiers = { ...PLAIN, ctrlKey: true }
const VISIBLE = [5, 3, 9, 1, 7]

const ids = (state: { ids: ReadonlySet<number> }) => [...state.ids].sort((a, b) => a - b)

describe('selection', () => {
  it('starts empty and inactive', () => {
    expect(selectionActive(EMPTY_SELECTION)).toBe(false)
    expect(allSelected(EMPTY_SELECTION, VISIBLE)).toBe(false)
  })

  it('toggles a row on and off, moving the anchor', () => {
    const on = toggleSelected(EMPTY_SELECTION, 3)
    expect(ids(on)).toEqual([3])
    expect(on.anchor).toBe(3)
    expect(selectionActive(on)).toBe(true)
    expect(ids(toggleSelected(on, 3))).toEqual([])
  })

  it('a plain click outside selection mode is not a selection gesture', () => {
    const { state, handled } = clickSelected(EMPTY_SELECTION, 9, PLAIN, VISIBLE)
    expect(handled).toBe(false)
    expect(ids(state)).toEqual([])
    expect(state.anchor).toBe(9)
  })

  it('a plain click puts an existing selection down', () => {
    const selected = toggleSelected(toggleSelected(EMPTY_SELECTION, 5), 3)
    const { state, handled } = clickSelected(selected, 1, PLAIN, VISIBLE)
    expect(handled).toBe(false)
    expect(ids(state)).toEqual([])
  })

  it('cmd and ctrl toggle without leaving the rest', () => {
    const first = clickSelected(EMPTY_SELECTION, 5, META, VISIBLE)
    expect(first.handled).toBe(true)
    const second = clickSelected(first.state, 1, CTRL, VISIBLE)
    expect(ids(second.state)).toEqual([1, 5])
  })

  it('in selection mode a plain tap toggles', () => {
    const inMode = enterSelection(EMPTY_SELECTION)
    const { state, handled } = clickSelected(inMode, 7, PLAIN, VISIBLE)
    expect(handled).toBe(true)
    expect(ids(state)).toEqual([7])
  })

  it('shift-click selects the range from the anchor in the order on screen', () => {
    const anchored = clickSelected(EMPTY_SELECTION, 3, PLAIN, VISIBLE).state
    const { state, handled } = clickSelected(anchored, 1, SHIFT, VISIBLE)
    expect(handled).toBe(true)
    // 3, 9, 1 in visible order — not 1, 2, 3 by id.
    expect(ids(state)).toEqual([1, 3, 9])
  })

  it('moving a shift-click back shrinks the one range rather than adding to it', () => {
    const anchored = clickSelected(EMPTY_SELECTION, 5, PLAIN, VISIBLE).state
    const wide = clickSelected(anchored, 7, SHIFT, VISIBLE).state
    const narrow = clickSelected(wide, 3, SHIFT, VISIBLE).state
    expect(ids(narrow)).toEqual([3, 5])
    expect(narrow.anchor).toBe(5)
  })

  it('shift-click upwards works the same as downwards', () => {
    const anchored = clickSelected(EMPTY_SELECTION, 7, PLAIN, VISIBLE).state
    expect(ids(clickSelected(anchored, 9, SHIFT, VISIBLE).state)).toEqual([1, 7, 9])
  })

  it('shift-click with no anchor, or an anchor no longer visible, selects just that row', () => {
    expect(ids(clickSelected(EMPTY_SELECTION, 9, SHIFT, VISIBLE).state)).toEqual([9])
    const anchoredElsewhere = { ...EMPTY_SELECTION, anchor: 42 }
    expect(ids(clickSelected(anchoredElsewhere, 9, SHIFT, VISIBLE).state)).toEqual([9])
  })

  it('entering selection mode can start from a row', () => {
    const state = enterSelection(EMPTY_SELECTION, 9)
    expect(state.mode).toBe(true)
    expect(ids(state)).toEqual([9])
  })

  it('select all turns mode on and takes every visible row', () => {
    const state = selectAllVisible(EMPTY_SELECTION, VISIBLE)
    expect(state.mode).toBe(true)
    expect(allSelected(state, VISIBLE)).toBe(true)
  })

  it('deselect all stays in mode; clear leaves it', () => {
    const all = selectAllVisible(EMPTY_SELECTION, VISIBLE)
    const none = deselectAll(all)
    expect(ids(none)).toEqual([])
    expect(none.mode).toBe(true)
    const cleared = clearSelection(all)
    expect(ids(cleared)).toEqual([])
    expect(cleared.mode).toBe(false)
    expect(selectionActive(cleared)).toBe(false)
  })

  it('prunes to what is visible, so a batch action never touches a hidden song', () => {
    const all = selectAllVisible(EMPTY_SELECTION, VISIBLE)
    const filtered = pruneSelection(all, [3, 1])
    expect(ids(filtered)).toEqual([1, 3])
    expect(allSelected(filtered, [3, 1])).toBe(true)
  })

  it('re-sorting is not a change of contents: nothing is dropped, and nothing is allocated', () => {
    const all = selectAllVisible(EMPTY_SELECTION, VISIBLE)
    expect(pruneSelection(all, [...VISIBLE].reverse())).toBe(all)
  })

  it('returns the same object for every no-op', () => {
    expect(deselectAll(EMPTY_SELECTION)).toBe(EMPTY_SELECTION)
    expect(clearSelection(EMPTY_SELECTION)).toBe(EMPTY_SELECTION)
    expect(pruneSelection(EMPTY_SELECTION, VISIBLE)).toBe(EMPTY_SELECTION)
    const inMode = enterSelection(EMPTY_SELECTION)
    expect(enterSelection(inMode)).toBe(inMode)
  })
})
