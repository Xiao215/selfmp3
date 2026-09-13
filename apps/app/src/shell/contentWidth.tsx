import { createContext, useContext } from 'react'

/**
 * How wide the page column is at desktop width, once it has been measured.
 *
 * The window is the wrong measure for a screen's own layout: the sidebar takes
 * 244 of it, and the practice panel another 340 when it is open. A row that
 * chose its columns from the window drew an album column into a page too narrow
 * for one. Null until the shell has laid the column out, and on a phone.
 */
export const ContentWidthContext = createContext<number | null>(null)

export function useContentWidth(): number | null {
  return useContext(ContentWidthContext)
}
