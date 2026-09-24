import { useContext } from 'react'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'
import { MINI_PLAYER_HEIGHT, NAV_HEIGHT } from '@selfmp3/client'
import { useSongLoaded } from '../player/PlayerProvider'
import { usePageChrome } from './pageChrome'
import { useLayout } from './useLayout'

/**
 * On a phone the tab bar and the mini player float over the page (docs/ui-mock
 * `P04`), so a list runs on under them and has to leave room at its end or its
 * last rows sit behind the bar for good. Every scrolling page takes its bottom
 * padding from here, so the arithmetic is written once
 * (docs/UI-MIGRATION.md, Risks: "one `useBottomInset()` that every list uses").
 */

/** Space between the mini player and the bar under it. */
export const MINI_PLAYER_GAP = 10

/** Space kept under the last row, past the floating chrome. */
const BREATHING_ROOM = 12

/**
 * How far above the foot of the display the bar floats: just clear of the
 * home indicator where there is one, 16 where there is not.
 */
export function navBottom(safeBottom: number): number {
  return safeBottom > 0 ? safeBottom + 2 : 16
}

/** The height the floating chrome takes from the foot of the display. */
function floatingChromeHeight(safeBottom: number, miniPlayer: boolean): number {
  return (
    navBottom(safeBottom) + NAV_HEIGHT + (miniPlayer ? MINI_PLAYER_GAP + MINI_PLAYER_HEIGHT : 0)
  )
}

/**
 * How much of the foot of a phone's page the floating chrome covers, for
 * things that float above it: toasts, the selection bar. Zero on a computer.
 */
export function useFloatingChrome(): number {
  const { wide } = useLayout()
  // The context rather than `useSafeAreaInsets`, which throws outside a
  // provider: a screen drawn alone in a test has none, and no inset to keep.
  const safeBottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0
  const loaded = useSongLoaded()
  // Nothing floats over a page that owns the display (`pageChrome.ts`), so it
  // keeps no room at its foot for a bar that is not there.
  const chrome = usePageChrome()
  return wide || !chrome ? 0 : floatingChromeHeight(safeBottom, loaded)
}

/**
 * The bottom padding a scrolling page needs: the floating chrome on a phone,
 * nothing on a computer, whose player bar takes its own row under the page.
 */
export function useBottomInset(): number {
  const chrome = useFloatingChrome()
  return chrome === 0 ? 0 : chrome + BREATHING_ROOM
}

/**
 * The padding a foot fixed under a page needs — a review's Import button,
 * which stays put however long the list. Clear of the floating chrome where
 * there is one; on a phone page that owns the display, clear of the home
 * indicator, which the page's SafeAreaView leaves to its foot
 * (`edges={['top']}`) so the list can run under it. Nothing on a computer,
 * whose player bar takes its own row under the page.
 */
export function useFootInset(): number {
  const { wide } = useLayout()
  const safeBottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0
  const chrome = useFloatingChrome()
  if (wide) return 0
  return chrome > 0 ? chrome + BREATHING_ROOM : safeBottom
}
