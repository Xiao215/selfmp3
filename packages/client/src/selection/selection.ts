/**
 * Multi-select for a list of songs, as rules rather than a hook.
 *
 * The web app's `useSelection` held these inside React state. They are pulled
 * out so the library and a playlist share them on every platform, and so the
 * parts that decide which songs a batch action touches are tested on their own.
 * The hooks around them only add what is genuinely per-platform: Escape on a
 * keyboard, and clearing when the route changes.
 *
 * The rules, unchanged from the web app:
 *
 *  1. **The selection is always a subset of what you can see.** Anything that
 *     leaves the visible list leaves the selection with it, so "remove 40
 *     songs" means the forty on screen.
 *  2. **Re-sorting is not a change of contents.** A selection survives it, and a
 *     range is resolved against the order at the moment of the click.
 *  3. **Selection mode is explicit.** A phone has no modifier keys, so the
 *     checkboxes can come out and stay out; in that mode a plain tap toggles.
 *     Outside it a plain click puts the selection down.
 *  4. **Escape always gets you out** — the hook's job, since it is a key.
 *
 * Every function returns the same object when nothing changed, so a React
 * state setter given the result does not re-render for a no-op.
 */

export interface SelectionState {
  readonly ids: ReadonlySet<number>
  /** True while a plain tap toggles rather than plays. */
  readonly mode: boolean
  /** The row a shift-click range extends from: the last one clicked. */
  readonly anchor: number | null
}

/** The bits of a mouse or keyboard event a selection gesture cares about. */
export interface SelectionModifiers {
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
}

const NO_IDS: ReadonlySet<number> = new Set()

export const EMPTY_SELECTION: SelectionState = { ids: NO_IDS, mode: false, anchor: null }

/** Checkboxes showing: something selected, or selection mode on. */
export function selectionActive(state: SelectionState): boolean {
  return state.mode || state.ids.size > 0
}

/** Every visible row is selected. */
export function allSelected(state: SelectionState, visibleIds: readonly number[]): boolean {
  return visibleIds.length > 0 && state.ids.size === visibleIds.length
}

/** Toggle one row, and make it the anchor for the next shift-click. */
export function toggleSelected(state: SelectionState, id: number): SelectionState {
  const ids = new Set(state.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  return { ...state, ids, anchor: id }
}

/** Everything between the anchor and `id`, in the order now on screen. */
function rangeTo(state: SelectionState, id: number, visibleIds: readonly number[]): number[] {
  if (state.anchor === null) return [id]
  const start = visibleIds.indexOf(state.anchor)
  const end = visibleIds.indexOf(id)
  if (start === -1 || end === -1) return [id]
  const [low, high] = start <= end ? [start, end] : [end, start]
  return visibleIds.slice(low, high + 1)
}

export interface ClickResult {
  readonly state: SelectionState
  /**
   * True when the click was a selection gesture, and the row should not also
   * do its ordinary thing (play, open).
   */
  readonly handled: boolean
}

/** A click or tap on a row. */
export function clickSelected(
  state: SelectionState,
  id: number,
  modifiers: SelectionModifiers,
  visibleIds: readonly number[],
): ClickResult {
  if (modifiers.shiftKey) {
    // The anchor stays put, so moving a shift-click up and down the list grows
    // and shrinks one range instead of leaving a trail behind it.
    return { state: { ...state, ids: new Set(rangeTo(state, id, visibleIds)) }, handled: true }
  }
  if (modifiers.metaKey || modifiers.ctrlKey || state.mode) {
    return { state: toggleSelected(state, id), handled: true }
  }
  // Outside selection mode a plain click puts the selection down, but still
  // moves the anchor: shift-clicking a second row then means the range between
  // the two, as it does in a file browser.
  if (state.ids.size === 0 && state.anchor === id) return { state, handled: false }
  return { state: { ...state, ids: NO_IDS, anchor: id }, handled: false }
}

/** Turn the checkboxes on, optionally selecting one row to start from. */
export function enterSelection(state: SelectionState, id?: number): SelectionState {
  const on = state.mode ? state : { ...state, mode: true }
  return id === undefined ? on : toggleSelected(on, id)
}

export function selectAllVisible(
  state: SelectionState,
  visibleIds: readonly number[],
): SelectionState {
  return { ...state, mode: true, ids: new Set(visibleIds) }
}

/** Empty the selection but stay in selection mode. */
export function deselectAll(state: SelectionState): SelectionState {
  return state.ids.size === 0 ? state : { ...state, ids: NO_IDS }
}

/** Empty the selection and leave selection mode. The anchor is kept. */
export function clearSelection(state: SelectionState): SelectionState {
  return state.ids.size === 0 && !state.mode ? state : { ...state, ids: NO_IDS, mode: false }
}

/**
 * Rule 1: drop whatever is no longer visible. Allocates nothing unless
 * something actually dropped out, so re-sorting costs a lookup per selected row.
 */
export function pruneSelection(
  state: SelectionState,
  visibleIds: readonly number[],
): SelectionState {
  if (state.ids.size === 0) return state
  const visible = new Set(visibleIds)
  let dropped = false
  const ids = new Set<number>()
  for (const id of state.ids) {
    if (visible.has(id)) ids.add(id)
    else dropped = true
  }
  return dropped ? { ...state, ids } : state
}
