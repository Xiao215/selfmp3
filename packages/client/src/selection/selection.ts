/**
 * Multi-select for a list of songs (or of links: the rules are the same for any
 * id), as rules rather than a hook.
 *
 * Held as plain rules rather than inside React state, so the library and a
 * playlist share them on every platform, and so the parts that decide which
 * songs a batch action touches are tested on their own. The hooks around them
 * only add what is genuinely per-platform: Escape on a keyboard, and clearing
 * when the route changes.
 *
 * The rules:
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

export interface SelectionState<Id = number> {
  readonly ids: ReadonlySet<Id>
  /** True while a plain tap toggles rather than plays. */
  readonly mode: boolean
  /** The row a shift-click range extends from: the last one clicked. */
  readonly anchor: Id | null
}

/** The bits of a mouse or keyboard event a selection gesture cares about. */
export interface SelectionModifiers {
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
}

const NO_IDS: ReadonlySet<never> = new Set()

export const EMPTY_SELECTION: SelectionState<never> = { ids: NO_IDS, mode: false, anchor: null }

/** Checkboxes showing: something selected, or selection mode on. */
export function selectionActive<Id>(state: SelectionState<Id>): boolean {
  return state.mode || state.ids.size > 0
}

/** Every visible row is selected. */
export function allSelected<Id>(state: SelectionState<Id>, visibleIds: readonly Id[]): boolean {
  return visibleIds.length > 0 && state.ids.size === visibleIds.length
}

/**
 * Toggle one row, and make it the anchor for the next shift-click.
 *
 * Unticking the last selected row also leaves selection mode: with nothing
 * selected there is nothing for the checkboxes to be for, and making someone
 * find the ✕ as well is one step too many. Emptying the selection from the
 * bar's own checkbox (`clearSelection`) leaves it for the same reason: a bar
 * over a list with nothing chosen reads as something left behind.
 */
export function toggleSelected<Id>(state: SelectionState<Id>, id: Id): SelectionState<Id> {
  const ids = new Set(state.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  const mode = ids.size === 0 && state.ids.size > 0 ? false : state.mode
  return { ...state, ids, mode, anchor: id }
}

/** Everything between the anchor and `id`, in the order now on screen. */
function rangeTo<Id>(state: SelectionState<Id>, id: Id, visibleIds: readonly Id[]): Id[] {
  if (state.anchor === null) return [id]
  const start = visibleIds.indexOf(state.anchor)
  const end = visibleIds.indexOf(id)
  if (start === -1 || end === -1) return [id]
  const [low, high] = start <= end ? [start, end] : [end, start]
  return visibleIds.slice(low, high + 1)
}

interface ClickResult<Id> {
  readonly state: SelectionState<Id>
  /**
   * True when the click was a selection gesture, and the row should not also
   * do its ordinary thing (play, open).
   */
  readonly handled: boolean
}

/** A click or tap on a row. */
export function clickSelected<Id>(
  state: SelectionState<Id>,
  id: Id,
  modifiers: SelectionModifiers,
  visibleIds: readonly Id[],
): ClickResult<Id> {
  if (modifiers.shiftKey) {
    // The anchor stays put, so moving a shift-click up and down the list grows
    // and shrinks one range instead of leaving a trail behind it. With none to
    // range from — or one no longer in the list — this row becomes it.
    const anchored = state.anchor !== null && visibleIds.includes(state.anchor)
    return {
      state: {
        ...state,
        ids: new Set(rangeTo(state, id, visibleIds)),
        anchor: anchored ? state.anchor : id,
      },
      handled: true,
    }
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
export function enterSelection<Id>(state: SelectionState<Id>, id?: Id): SelectionState<Id> {
  const on = state.mode ? state : { ...state, mode: true }
  return id === undefined ? on : toggleSelected(on, id)
}

export function selectAllVisible<Id>(
  state: SelectionState<Id>,
  visibleIds: readonly Id[],
): SelectionState<Id> {
  return { ...state, mode: true, ids: new Set(visibleIds) }
}

/**
 * Empty the selection and leave selection mode. The anchor is kept.
 *
 * The bar's own deselect-all is this too: with nothing chosen there is nothing
 * for a bar to act on, and the bar goes with the ticks.
 */
export function clearSelection<Id>(state: SelectionState<Id>): SelectionState<Id> {
  return state.ids.size === 0 && !state.mode ? state : { ...state, ids: NO_IDS, mode: false }
}

/**
 * Rule 1: drop whatever is no longer visible. Allocates nothing unless
 * something actually dropped out, so re-sorting costs a lookup per selected row.
 */
export function pruneSelection<Id>(
  state: SelectionState<Id>,
  visibleIds: readonly Id[],
): SelectionState<Id> {
  if (state.ids.size === 0) return state
  const visible = new Set(visibleIds)
  let dropped = false
  const ids = new Set<Id>()
  for (const id of state.ids) {
    if (visible.has(id)) ids.add(id)
    else dropped = true
  }
  return dropped ? { ...state, ids } : state
}
