import { useEffect } from 'react'

/**
 * Call `onEscape` when Escape is pressed anywhere on the page, while `active`.
 *
 * A menu, dialog or dropdown gets Escape first: it is closing itself, not
 * dismantling whatever is underneath it — the same rule the web app's
 * selection followed.
 */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('[role="menu"], [role="dialog"], [role="listbox"], [role="combobox"]')
      ) {
        return
      }
      onEscape()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, onEscape])
}
