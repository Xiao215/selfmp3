/** Widgets that run their own keys. */
const RUNS_ITS_OWN_KEYS = '[role="combobox"], [role="listbox"], [role="menu"], [role="dialog"]'

/**
 * Whether a key pressed where focus is belongs to what has focus rather than
 * to the page — the one test the page's own keys (`useHotkeys.web.ts`) and
 * Escape (`useEscape.web.ts`) both stand aside on.
 *
 * A menu, a list box, a combo box or a dialog runs its own keys: arrows, Enter,
 * Escape. When `typing`, a text field owns the keys too, where a letter is a
 * word and not a shortcut. Escape is not typing: it leaves a field as readily
 * as anywhere, so only those widgets keep it.
 */
export function focusOwnsKey(target: EventTarget | null, { typing }: { typing: boolean }): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (
    typing &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return true
  }
  return target.closest(RUNS_ITS_OWN_KEYS) !== null
}
