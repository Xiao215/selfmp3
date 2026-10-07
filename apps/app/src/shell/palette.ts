import { createValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'

/**
 * Whether the command palette is open.
 *
 * Two things open it and neither draws it: the sidebar's Search row, and the
 * installed app's View › Search (⌘K), which arrives as a menu command. The
 * shell draws the palette, so the choice lives here rather than in any of the
 * three — the same arrangement as `practicePanel.ts`.
 */
const open = createValueStore(false)

export const setPaletteOpen = open.set

export function usePaletteOpen(): boolean {
  return useValueStore(open)
}
