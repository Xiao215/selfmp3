import { createContext, useContext } from 'react'

/**
 * Whether the items being drawn sit in a panel anchored beside its control
 * with a mouse to hand, rather than in a sheet.
 *
 * The web draws the same `.popover-item` at two sizes: 8 by 10 of padding in a
 * popover, and a finger's 44 with larger type once the popover becomes a sheet.
 * `SheetItem` is used in both, and cannot tell which from where it is written,
 * so the popover says so. Its own file so that `Sheet` and `Popover`, which
 * import each other's parts, do not import each other.
 */
export const PanelDenseContext = createContext(false)

export function usePanelDense(): boolean {
  return useContext(PanelDenseContext)
}
