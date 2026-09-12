import { useEffect, useId } from 'react'

import type { EscapeOptions } from './useEscape'

export type { EscapeOptions }

/** Open layers, oldest first. The last one is on top. */
const layers: string[] = []

/**
 * Call `onEscape` when Escape is pressed anywhere on the page, while `active`.
 *
 * Two kinds of listener, because two kinds of thing close on Escape.
 *
 * A **layer** (a sheet, a popover, a dialog) listens in the capture phase.
 * Only the topmost open layer acts, and it stops the event there, so one press
 * closes one thing and never what lies beneath it.
 *
 * Anything else, such as the library's selection, listens in the bubble phase,
 * so a layer has already had its chance. It also stands aside when focus is
 * inside a menu, dialog, listbox or combobox, which is closing itself — the
 * rule the web app's selection followed.
 */
export function useEscape(
  active: boolean,
  onEscape: () => void,
  { layer = false }: EscapeOptions = {},
): void {
  const id = useId()

  useEffect(() => {
    if (!active) return undefined

    if (layer) {
      layers.push(id)
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || layers[layers.length - 1] !== id) return
        event.preventDefault()
        event.stopPropagation()
        onEscape()
      }
      window.addEventListener('keydown', onKeyDown, true)
      return () => {
        window.removeEventListener('keydown', onKeyDown, true)
        const index = layers.lastIndexOf(id)
        if (index !== -1) layers.splice(index, 1)
      }
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
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
  }, [active, onEscape, layer, id])
}
