import { useContext, useMemo, type ReactNode } from 'react'
import { View } from 'react-native'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'
import { StyleSheet } from 'react-native-unistyles'

import { TITLE_BAR_DRAG_ID } from '../ports/titleBarDragId'
import { titleBarInset } from '../ports/titleBarInset'
import { useLayoutValue } from './useLayout'

/**
 * Room for the Mac's traffic lights in a narrow desktop window, and something
 * to drag the window by.
 *
 * A computer's layout keeps clear of them with the sidebar, which pads its top
 * and is dragged by its own strip. Below the breakpoint there is no sidebar:
 * the window wears the phone's layout, whose pages start under a status bar —
 * the safe area's top. So here the traffic lights *are* the status bar: the
 * inset is added to the safe area's top, and every page, sheet and Now Playing
 * that already clears a phone's status bar clears them too, with a strip across
 * the room they leave that the window is dragged by. Without it, a page's Back
 * sat under the red button and the window could not be moved at all.
 *
 * Nothing anywhere else: a phone, a browser tab and a wide window pass the
 * insets through untouched.
 */
export function TitleBarRoom({ children }: { children: ReactNode }): ReactNode {
  const room = useTitleBarRoom()
  const insets = useContext(SafeAreaInsetsContext)
  const value = useMemo(
    () => (room > 0 && insets ? { ...insets, top: insets.top + room } : insets),
    [room, insets],
  )
  if (titleBarInset === 0) return children
  return (
    <SafeAreaInsetsContext.Provider value={value}>
      {children}
      {room > 0 ? <TitleBarDrag name="narrow" /> : null}
    </SafeAreaInsetsContext.Provider>
  )
}

/**
 * How much the traffic lights add to the top of the safe area: their height in
 * a narrow desktop window, and nothing anywhere else. For a browser's
 * safe-area view, which pays no attention to the insets (`SafeAreaView.web`).
 */
export function useTitleBarRoom(): number {
  const narrow = useLayoutValue(layout => !layout.wide)
  return titleBarInset > 0 && narrow ? titleBarInset : 0
}

/**
 * A strip across the top of the window that drags it, the traffic lights' own
 * height, where the shell drew them over the page. For a page with no sidebar
 * at any width — the welcome pages — whose top is clear of anything to press.
 * Nothing where there is no inset title bar.
 */
export function TitleBarDrag({ name }: { name: string }): ReactNode {
  if (titleBarInset === 0) return null
  return (
    <View
      nativeID={`${TITLE_BAR_DRAG_ID}-${name}`}
      style={[styles.strip, { height: titleBarInset }]}
    />
  )
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', top: 0, left: 0, right: 0 },
})
