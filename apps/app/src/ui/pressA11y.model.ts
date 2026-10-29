/**
 * What a browser is told about a pressable, which react-native-web leaves to
 * the `aria-*` props: it turns `accessibilityState` and `accessibilityValue`
 * into nothing at all, so a lit Shuffle, an open Sort list and a chosen
 * option read the same as their opposites. `Press` fills these in from the
 * two, where the caller has not said them itself.
 */

interface State {
  readonly selected?: boolean
  readonly checked?: boolean | 'mixed'
  readonly expanded?: boolean
  readonly busy?: boolean
  readonly disabled?: boolean
}

interface Value {
  readonly min?: number
  readonly max?: number
  readonly now?: number
  readonly text?: string
}

/** The roles a browser's readers take `aria-selected` from. */
const SELECTABLE = new Set(['option', 'tab', 'row', 'gridcell', 'treeitem', 'columnheader'])

/** The roles that are ticked or switched: `aria-checked`. */
const CHECKABLE = new Set(['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'])

/**
 * The `aria-*` props for a pressable's state and value. `selected` on a link
 * is the page you are on, `aria-current`; on anything else that is neither
 * selectable nor checkable it says nothing a browser would read, so it is
 * left out. Not `aria-pressed` for a button: most buttons say `selected:
 * false` without being toggles, and a toggle says so itself (`IconButton`).
 */
export function ariaFor(
  role: string | undefined,
  state: State | undefined,
  value: Value | undefined,
): Record<string, string | number | boolean> {
  const aria: Record<string, string | number | boolean> = {}
  if (state) {
    if (state.selected !== undefined) {
      if (role !== undefined && SELECTABLE.has(role)) aria['aria-selected'] = state.selected
      else if (role === 'link' && state.selected) aria['aria-current'] = 'page'
    }
    if (state.checked !== undefined && role !== undefined && CHECKABLE.has(role)) {
      aria['aria-checked'] = state.checked
    }
    if (state.expanded !== undefined) aria['aria-expanded'] = state.expanded
    if (state.busy !== undefined) aria['aria-busy'] = state.busy
    if (state.disabled) aria['aria-disabled'] = true
  }
  if (value) {
    if (value.min !== undefined) aria['aria-valuemin'] = value.min
    if (value.max !== undefined) aria['aria-valuemax'] = value.max
    if (value.now !== undefined) aria['aria-valuenow'] = value.now
    if (value.text !== undefined) aria['aria-valuetext'] = value.text
  }
  return aria
}

/**
 * The roles Space presses as well as Enter. react-native-web's press
 * responder takes Space only for a button, but a switch is flipped, a radio
 * chosen and a tab opened by Space too (WAI-ARIA's patterns), and a menu's
 * item and a list's option are picked by it.
 */
const SPACE_PRESSES = new Set([
  'switch',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
])

export function spacePresses(role: string | undefined): boolean {
  return role !== undefined && SPACE_PRESSES.has(role)
}
