import { useState } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '@selfmp3/client'
import { BottomNav } from '../ui/components/BottomNav'
import { MiniPlayer } from '../ui/components/MiniPlayer'
import { ResumeToast } from '../features/devices/ResumeToast'
import { CommandPalette } from '../features/palette/CommandPalette'
import { PlaybackNotices } from '../offline/PlaybackNotices'
import { OverlayProvider } from './Overlay'
import { PlayerBar } from './PlayerBar'
import { Sidebar } from './Sidebar'
import { useHotkeys } from './useHotkeys'
import { useLayout } from './useLayout'

/**
 * The frame around every screen, and the only thing that knows the width.
 *
 * Below 820 it is the phone: the screen fills the display with a mini player
 * and a tab bar stacked under it. At 820 and above it is the desktop: a sidebar
 * down the left, the screen beside it, a player bar across the foot. Same
 * routes, same screens, same providers — `docs/UNIVERSAL.md`, foundation 5.
 *
 * Dragging a browser window across the breakpoint swaps the chrome without
 * remounting the screen, because the screen is `children` either way and React
 * keeps it. That is the resize flow in the plan's list, and it is a property of
 * this arrangement rather than something handled separately.
 */
export function Shell({
  children,
  chrome,
  sidebar = true,
}: {
  children: ReactNode
  /** False while a screen owns the whole display, and before there is a server. */
  chrome: boolean
  /**
   * False while a desktop screen covers the sidebar but not the player bar:
   * Now Playing, which keeps play and pause where your hand already is.
   */
  sidebar?: boolean
}): ReactNode {
  const { wide } = useLayout()

  return (
    <OverlayProvider>
      {frame(wide, chrome, sidebar, children)}
      <PlaybackNotices />
      <PaletteHost />
    </OverlayProvider>
  )
}

/**
 * The frame itself, with the overlay host already wrapped around it so sheets
 * and popovers land above the tab bar and the player bar rather than inside
 * whichever screen opened them.
 */
function frame(wide: boolean, chrome: boolean, sidebar: boolean, children: ReactNode): ReactNode {
  if (!chrome) return <View style={styles.root}>{children}</View>

  if (wide) {
    return (
      <View style={styles.root} testID="shell-wide">
        <View style={styles.columns}>
          {sidebar ? <Sidebar /> : null}
          <View style={styles.content}>
            {children}
            <Toasts />
          </View>
        </View>
        <PlayerBar />
      </View>
    )
  }

  return (
    <View style={styles.root} testID="shell-compact">
      <View style={styles.content}>
        {children}
        <Toasts />
      </View>
      <MiniPlayer />
      <BottomNav />
    </View>
  )
}

/** ⌘K, or Ctrl+K, anywhere: the command palette. */
function PaletteHost(): ReactNode {
  const [open, setOpen] = useState(false)
  useHotkeys({ 'meta+k': () => setOpen(true), 'ctrl+k': () => setOpen(true) })
  // Mounted only while open, so each opening starts with an empty box.
  return open ? <CommandPalette onClose={() => setOpen(false)} /> : null
}

/**
 * The web's toast row: at the foot of the content column, above the player bar
 * or the mini player, so a message never covers the transport.
 */
function Toasts(): ReactNode {
  return (
    <View style={styles.toasts} pointerEvents="box-none">
      <ResumeToast />
    </View>
  )
}

const styles = StyleSheet.create({
  toasts: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  root: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  content: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
})
