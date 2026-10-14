import { useEffect, useId, useRef } from 'react'

import { registerKey } from './keyRegistry'
import { closeLayer, layerOpen, onTop, openLayer } from './layers'

export interface EscapeOptions {
  /**
   * Something drawn over the page — a sheet, a popover, a dialog. The topmost
   * open layer takes Escape and nothing underneath hears it. Without this the
   * hook is for the page itself, such as a selection, and yields to any
   * layer.
   */
  readonly layer?: boolean
}

/**
 * Call `onEscape` when Escape is pressed, while `active`.
 *
 * On an iPad or an iPhone with a hardware keyboard, Escape is a key command
 * (`keyRegistry`), answered as the web answers it (`useEscape.web.ts`): the
 * topmost open layer alone, and only with no layer open, everything else that
 * asked — the selection, Now Playing. It answers in a text field too: Escape
 * types nothing. An input method composing takes it first (the native module
 * keeps it from here). A phone without a keyboard has no Escape to press, and
 * on Android, which has no module, nothing is registered.
 *
 * The callback is held in a ref, as on the web, so an inline `onClose` does
 * not take a sheet out of the layer stack and put it back on top on every
 * render of its parent.
 */
export function useEscape(
  active: boolean,
  onEscape: () => void,
  { layer = false }: EscapeOptions = {},
): void {
  const id = useId()
  const latest = useRef(onEscape)
  useEffect(() => {
    latest.current = onEscape
  })

  useEffect(() => {
    if (!active) return undefined
    if (layer) {
      openLayer(id)
      const remove = registerKey({
        combination: 'Escape',
        whileTyping: true,
        run: () => {
          if (!onTop(id)) return false
          latest.current()
          return true
        },
      })
      return () => {
        remove()
        closeLayer(id)
      }
    }
    return registerKey({
      combination: 'Escape',
      whileTyping: true,
      // Every page-level one hears it, as every window listener does on the
      // web, so each passes the press on.
      run: () => {
        if (!layerOpen()) latest.current()
        return false
      },
    })
  }, [active, layer, id])
}
