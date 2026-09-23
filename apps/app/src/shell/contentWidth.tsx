import { createContext, useContext } from 'react'

/**
 * How wide the page column is at desktop width: the window less what stands
 * beside the page, as the shell works it out (`Shell`).
 *
 * The window is the wrong measure for a screen's own layout: the sidebar takes
 * 244 of it, Up next 288 while it is open, and the practice panel another 340.
 * A row that chose its columns from the window drew an album column into a
 * page too narrow for one. Worked out and not measured, so that a panel
 * sliding in changes it once, to where the slide ends, and not every frame.
 * Null on a phone.
 */
export const ContentWidthContext = createContext<number | null>(null)

export function useContentWidth(): number | null {
  return useContext(ContentWidthContext)
}
