import { useEffect } from 'react'
import { usePathname } from 'expo-router'
import { createValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'

/**
 * The page last opened from the sidebar (or the palette's Go to), on a
 * computer: a page the sidebar opens is a place of its own, with nothing to
 * go back to, so it wears no ‹ even though the one stack holds the page it
 * was opened over (J1). A page opened from inside it does wear one.
 *
 * Kept as the address the page ended up at, read when the address next
 * changes after a sidebar press, rather than worked out from the link: a tag's
 * link is a route and its name, and the address is what every page can read.
 */
const entered = createValueStore<string | null>(null)

/** When the sidebar last navigated, so the next address can be taken as its. */
let pressedAt = 0

/** How long after a press a new address still counts as the sidebar's. */
const PRESS_WINDOW_MS = 1500

/** Call just before the sidebar (or the palette's Go to) navigates. */
export function enterFromSidebar(): void {
  pressedAt = Date.now()
}

/** Mounted once with the sidebar: takes the address a sidebar press arrived at. */
export function useRecordSidebarEntry(): void {
  const pathname = usePathname()
  useEffect(() => {
    if (Date.now() - pressedAt > PRESS_WINDOW_MS) return
    pressedAt = 0
    entered.set(pathname)
  }, [pathname])
}

/** Whether the page showing is the one the sidebar opened. */
export function useOpenedFromSidebar(): boolean {
  const pathname = usePathname()
  return useValueStore(entered) === pathname
}
