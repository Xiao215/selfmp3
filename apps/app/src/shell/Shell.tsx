import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { router } from 'expo-router'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { BottomNav } from '../ui/components/BottomNav'
import { MiniPlayer } from '../ui/components/MiniPlayer'
import { ResumeToast } from '../features/devices/ResumeToast'
import { CommandPalette } from '../features/palette/CommandPalette'
import { PlaybackNotices } from '../offline/PlaybackNotices'
import { ToastHost } from '../ui/components/ToastHost'
import { OverlayProvider } from './Overlay'
import { PlayerBar } from './PlayerBar'
import { FocusStyle } from './FocusStyle'
import { TooltipHost } from './TooltipHost'
import { Sidebar } from './Sidebar'
import { stageIdle, subscribeStageIdle } from './stageIdle'
import { useCommands } from './useCommands'
import { useHotkeys } from './useHotkeys'
import { useLayout } from './useLayout'
import { PracticePanel } from '../features/practice/PracticePanel'
import { ContentWidthContext } from './contentWidth'
import { practiceOpen, setPracticeOpen, usePracticeOpen } from './practicePanel'

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
  // Focus with a still mouse: the bar folds away and the page takes its room.
  const barHidden = useSyncExternalStore(subscribeStageIdle, stageIdle, stageIdle)

  return (
    <OverlayProvider>
      {frame(wide, chrome, sidebar, barHidden, children)}
      <PlaybackNotices />
      <PaletteHost />
      <MenuCommands />
      {/* Hover captions in a browser; nothing on a phone. */}
      <TooltipHost />
      {/* A focused field in the accent, not the browser's own ring. */}
      <FocusStyle />
    </OverlayProvider>
  )
}

/**
 * The frame itself, with the overlay host already wrapped around it so sheets
 * and popovers land above the tab bar and the player bar rather than inside
 * whichever screen opened them.
 */
function frame(
  wide: boolean,
  chrome: boolean,
  sidebar: boolean,
  barHidden: boolean,
  children: ReactNode,
): ReactNode {
  if (wide && chrome) {
    return (
      <WideFrame sidebar={sidebar} barHidden={barHidden}>
        {children}
      </WideFrame>
    )
  }

  // One tree with the chrome in it or not, never a different tree. When Now
  // Playing hid the tab bar by returning a bare view instead, React saw the
  // screens move to a new parent and remounted every one of them: closing Now
  // Playing put a page scrolled to its end back at the top.
  return (
    <View style={styles.root} testID={chrome ? 'shell-compact' : undefined}>
      <View style={styles.content}>
        {children}
        {chrome ? <Toasts /> : null}
      </View>
      {chrome ? <MiniPlayer /> : null}
      {chrome ? <BottomNav /> : null}
    </View>
  )
}

/** The desktop frame, which measures the page column for the screens inside it. */
function WideFrame({
  sidebar,
  barHidden,
  children,
}: {
  sidebar: boolean
  barHidden: boolean
  children: ReactNode
}): ReactNode {
  const [contentWidth, setContentWidth] = useState<number | null>(null)
  return (
    <View style={styles.root} testID="shell-wide">
      <View style={styles.columns}>
        {sidebar ? <Sidebar /> : null}
        <View
          style={styles.content}
          onLayout={event => setContentWidth(Math.round(event.nativeEvent.layout.width))}
        >
          <ContentWidthContext.Provider value={contentWidth}>
            {children}
          </ContentWidthContext.Provider>
          <Toasts />
        </View>
        <PracticeSide />
      </View>
      {barHidden ? null : <PlayerBar />}
    </View>
  )
}

/** The practice panel beside the page, while the player bar's metronome has it open. */
function PracticeSide(): ReactNode {
  const open = usePracticeOpen()
  return open ? <PracticePanel side onClose={() => setPracticeOpen(false)} /> : null
}

/**
 * What the desktop's application menu can ask for, beyond the palette.
 *
 * Going somewhere and opening the practice panel are things the page can do
 * today; the Playback items are phase 4's, and the menu does not draw them
 * until their handlers exist, so there is never a menu item that does nothing.
 */
function MenuCommands(): ReactNode {
  useCommands({
    library: () => router.navigate('/'),
    playlists: () => router.navigate('/playlists'),
    'now-playing': () => router.navigate('/now-playing'),
    settings: () => router.navigate('/settings'),
    practice: () => setPracticeOpen(!practiceOpen()),
  })
  return null
}

/**
 * ⌘K, or Ctrl+K, anywhere: the command palette.
 *
 * In the installed app the same key is a menu item, and macOS runs both — so
 * `useHotkeys` stands aside for anything the menu owns and the command arrives
 * through `useCommands` instead. One press, one palette, either way.
 */
function PaletteHost(): ReactNode {
  const [open, setOpen] = useState(false)
  useHotkeys({ 'meta+k': () => setOpen(true), 'ctrl+k': () => setOpen(true) })
  useCommands({ search: () => setOpen(true) })
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
      <ToastHost />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  toasts: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
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
}))
