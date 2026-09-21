import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { router, usePathname } from 'expo-router'
import { Animated, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet } from 'react-native-unistyles'
import { BottomNav } from '../ui/components/BottomNav'
import { MiniPlayer } from '../ui/components/MiniPlayer'
import { SELECTION_BAR_SPACE, useSelectionBarFloating } from '../ui/components/SelectionBar'
import { ResumeToast } from '../features/devices/ResumeToast'
import { CommandPalette } from '../features/commandPalette/CommandPalette'
import { PlaybackNotices } from '../offline/PlaybackNotices'
import { ToastHost } from '../ui/components/ToastHost'
import { OverlayProvider } from './Overlay'
import { PLAYER_BAR_HEIGHT, PlayerBar } from './PlayerBar'
import { FocusStyle } from './FocusStyle'
import { TooltipHost } from './TooltipHost'
import { Sidebar } from './Sidebar'
import { useFloatingChrome } from './bottomInset'
import { stageIdle, subscribeStageIdle } from './stageIdle'
import { useCommands } from './useCommands'
import { useLayout } from './useLayout'
import { ease, timing } from '../ui/motion'
import { MOVE_MS } from '../ui/motion.model'
import { pageKey, stepSide } from './pageStep'
import { stackMoves } from '../ports/stackMoves'
import { onDeepLinkRoute } from '../ports/deepLinks'
import { usePlayer } from '../player/PlayerProvider'
import { PracticePanel } from '../features/practice/PracticePanel'
import { QueueRail } from '../features/queue/QueueRail'
import { QueueSheet } from '../features/queue/QueueSheet'
import { useQueueSheetOpen } from '../features/queue/queueSheet.store'
import { ContentWidthContext } from './contentWidth'
import { setPaletteOpen, usePaletteOpen } from './palette'
import { practiceOpen, setPracticeOpen, usePracticeOpen, usePracticeSection } from './practicePanel'

/**
 * The frame around every screen, and the only thing that knows the width.
 *
 * Below 820 it is the phone: the screen fills the display, and a mini player
 * and a tab bar float over its foot (docs/ui-mock `P04`); every scrolling page
 * leaves room for them with `useBottomInset`. At 820 and above it is the desktop: a sidebar
 * down the left, the screen beside it, a player bar across the foot. Same
 * routes, same screens, same providers — `docs/ARCHITECTURE.md`, foundation 5.
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
  // Focus with a still mouse: the bar fades away over the page, which runs on under it.
  const barHidden = useSyncExternalStore(subscribeStageIdle, stageIdle, stageIdle)

  return (
    <OverlayProvider>
      {frame(wide, chrome, sidebar, barHidden, children)}
      <PlaybackNotices />
      <PaletteHost />
      <MenuCommands />
      <DeepLinkRoutes />
      {/* Hover captions in a browser; nothing on a phone. */}
      <TooltipHost />
      {/* A focused field in the accent, not the browser's own ring. */}
      <FocusStyle />
    </OverlayProvider>
  )
}

/**
 * The frame, with the overlay host already wrapped around it so sheets and
 * popovers land above the tab bar and the player bar rather than inside
 * whichever screen opened them.
 *
 * One tree at every width, the chrome in it or not. The page sits at the same
 * place in it whether the frame is a phone's or a computer's, so crossing 820 —
 * an iPad turned, a Split View divider dragged, a window resized — swaps the
 * chrome around the page and never remounts it: the song, the scroll, a
 * half-typed search and an open sheet stay (docs/ui-mock `T09`). Two frame
 * components, as this was, were two trees, and React rebuilt every screen at
 * the crossing. Now Playing's taking the tab bar away learned the same lesson
 * earlier: a page that moves to a new parent is a new page.
 *
 * Phone: the page, and over its foot the mini player and the tab bar, and over
 * those Up next when it is open (`P25`); Up next is there without the chrome
 * too, since Now Playing's foot opens it, and the toasts come after it so an
 * Undo is drawn over the sheet that asked for it. Computer: the sidebar, the
 * page (measured, for the screens that lay out by its width), Up next's rail
 * and the practice panel beside it, and the player bar across the foot.
 */
function frame(
  wide: boolean,
  chrome: boolean,
  sidebar: boolean,
  barHidden: boolean,
  children: ReactNode,
): ReactNode {
  return (
    <Frame wide={wide && chrome} chrome={chrome} sidebar={sidebar} barHidden={barHidden}>
      {children}
    </Frame>
  )
}

function Frame({
  wide,
  chrome,
  sidebar,
  barHidden,
  children,
}: {
  wide: boolean
  chrome: boolean
  sidebar: boolean
  barHidden: boolean
  children: ReactNode
}): ReactNode {
  const queueOpen = useQueueSheetOpen()
  const [contentWidth, setContentWidth] = useState<number | null>(null)
  return (
    <View style={styles.root} testID={wide ? 'shell-wide' : chrome ? 'shell-compact' : undefined}>
      <View style={styles.columns}>
        {wide && sidebar ? <Sidebar /> : null}
        <View
          style={styles.content}
          onLayout={event => setContentWidth(Math.round(event.nativeEvent.layout.width))}
        >
          <ContentWidthContext.Provider value={wide ? contentWidth : null}>
            <PageStep wide={wide}>{children}</PageStep>
          </ContentWidthContext.Provider>
          {wide ? <Toasts /> : null}
        </View>
        {/* Up next, between the page and the practice panel, across every page. */}
        {wide ? <QueueRail /> : null}
        {wide ? <PracticeSide /> : null}
      </View>
      {wide ? <BarSlot hidden={barHidden} /> : null}
      {!wide && chrome ? <MiniPlayer /> : null}
      {!wide && chrome ? <BottomNav /> : null}
      {wide ? null : <QueueSheet />}
      {!wide && (chrome || queueOpen) ? <Toasts /> : null}
    </View>
  )
}

/**
 * The player bar, once there is a song to show in it.
 *
 * With nothing loaded there is no bar and no space kept for one: a strip of
 * disabled transport under an empty library said "Nothing playing" in the
 * largest possible way. The first song slides it up from the foot of the
 * window, a fifth of a second, or at once where less motion is asked for. A
 * phone's mini player has always worked this way.
 *
 * Focus with a still mouse fades the bar rather than taking it out. Taking it
 * out remounted the whole bar at the next nudge of the mouse and changed the
 * page's height both ways, which re-centred the lyrics each time; Now Playing
 * reaches under the bar instead, so there is nothing to re-lay. Later in the
 * tree than the page, so drawn over it.
 */
function BarSlot({ hidden }: { hidden: boolean }): ReactNode {
  const player = usePlayer()
  const insets = useSafeAreaInsets()
  const loaded = player.current !== null
  const [rise] = useState(() => new Animated.Value(loaded ? 1 : 0))
  useEffect(() => {
    // Height, which the native driver cannot animate; it runs once per session.
    if (loaded) timing(rise, 1, 200, undefined, { easing: ease.out, native: false })
    else rise.setValue(0)
  }, [loaded, rise])

  if (!loaded) return null
  const full = PLAYER_BAR_HEIGHT + insets.bottom
  return (
    <Animated.View
      style={[
        styles.barSlot,
        { height: rise.interpolate({ inputRange: [0, 1], outputRange: [0, full] }) },
        hidden && styles.barHidden,
      ]}
      pointerEvents={hidden ? 'none' : 'auto'}
      aria-hidden={hidden}
    >
      {/* Its top edge rises with the slot; the rest waits below the window. */}
      <View style={[styles.barInSlot, { height: full }]}>
        <PlayerBar />
      </View>
    </Animated.View>
  )
}

/**
 * The page, stepping in as it changes (docs/ui-mock `M2`, 4 and `M3`, 5): on a
 * phone a few points from the side of the tab it belongs to, 200 ms; on a
 * computer from a few points below, 180, while the sidebar and the bar hold
 * still. `pageStep.ts` says which changes count.
 *
 * The one view around every screen rather than a move in each, so no page can
 * forget it, and the same on a phone, in a browser and in the desktop app —
 * a browser's stack has no transitions of its own. The phone's stack plays
 * none for its tabs (`app/_layout.tsx`), so the two never run together.
 *
 * Only the page that arrives moves; the one it replaces has already gone.
 */
function PageStep({ wide, children }: { wide: boolean; children: ReactNode }): ReactNode {
  const pathname = usePathname()
  const key = pageKey(pathname, wide, stackMoves)
  const [shown, setShown] = useState(key)
  const [step, setStep] = useState({ count: 0, side: 1 as -1 | 1 })
  if (key !== null && key !== shown) {
    setShown(key)
    if (shown !== null) setStep({ count: step.count + 1, side: stepSide(shown, key) })
  }
  const [value] = useState(() => new Animated.Value(1))
  // Before the paint, so the new page's first frame is already stepped aside.
  useLayoutEffect(() => {
    if (step.count === 0) return
    value.setValue(0)
    timing(value, 1, wide ? MOVE_MS.page : MOVE_MS.tab, undefined, { easing: ease.out })
  }, [step, value, wide])

  const offset = value.interpolate({
    inputRange: [0, 1],
    outputRange: [wide ? 6 : 8 * step.side, 0],
  })
  return (
    <Animated.View
      style={[
        styles.content,
        {
          opacity: value,
          transform: wide ? [{ translateY: offset }] : [{ translateX: offset }],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}

/** The practice panel beside the page, while the player bar's metronome has it open. */
function PracticeSide(): ReactNode {
  const open = usePracticeOpen()
  const section = usePracticeSection()
  return open ? (
    <PracticePanel side section={section} onClose={() => setPracticeOpen(false)} />
  ) : null
}

/**
 * What the desktop's application menu can ask for, beyond the palette.
 *
 * Going somewhere and opening the practice panel are things the page can do
 * today; the Playback items are phase 4's, and the menu does not draw them
 * until their handlers exist, so there is never a menu item that does nothing.
 */
/**
 * `selfmp3://playlist/12` and `selfmp3://now-playing`, from the operating
 * system: a link in a note, or one the app sent itself. Nothing on a phone or
 * in a browser, which have their own ways of being pointed at a page.
 */
function DeepLinkRoutes(): ReactNode {
  useEffect(
    () =>
      onDeepLinkRoute(route => {
        if (route.kind === 'now-playing') router.navigate('/now-playing')
        else router.navigate(`/playlists/${route.id}`)
      }),
    [],
  )
  return null
}

/** What a seek item moves the song by. Ten seconds is the podcast convention. */
const SEEK_STEP = 10
/** One notch of the volume keys, on the engine's 0–1 scale. */
const VOLUME_STEP = 0.05

/**
 * Everything the desktop's application menu can ask for.
 *
 * Nothing on a phone or in a browser tab: `useCommands` has no shell to listen
 * to there, and the keys the menu draws but does not take are only registered
 * where the menu exists. So this component is the frame's wiring for a window
 * with a menu bar, and a no-op everywhere else.
 */
function MenuCommands(): ReactNode {
  const player = usePlayer()
  useCommands({
    library: () => router.navigate('/library'),
    playlists: () => router.navigate('/playlists'),
    'now-playing': () => router.navigate('/now-playing'),
    settings: () => router.navigate('/settings'),
    practice: () => setPracticeOpen(!practiceOpen()),
    'play-pause': () => player.toggle(),
    next: () => player.next(),
    previous: () => player.previous(),
    'seek-forward': () => player.seekBy(SEEK_STEP),
    'seek-back': () => player.seekBy(-SEEK_STEP),
    shuffle: () => player.toggleShuffle(),
    repeat: () => player.cycleRepeatMode(),
    'volume-up': () => player.setVolume(Math.min(1, player.volume + VOLUME_STEP)),
    'volume-down': () => player.setVolume(Math.max(0, player.volume - VOLUME_STEP)),
    mute: () => player.toggleMute(),
  })
  return null
}

/**
 * The command palette, opened by the sidebar's Search row or, in the installed
 * app, by View › Search (⌘K), which arrives here as a menu command.
 *
 * A browser tab has no key for it on purpose (decided 2026-09-14): ⌘K there is
 * the browser's own, and a page that takes it answers a key the person meant
 * for the browser. The installed app has a menu that says ⌘K out loud.
 */
function PaletteHost(): ReactNode {
  const open = usePaletteOpen()
  useCommands({ search: () => setPaletteOpen(true) })
  // Mounted only while open, so each opening starts with an empty box.
  return open ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null
}

/**
 * The toast row: at the foot of the content column, above the player bar or
 * the mini player, so a message never covers the transport.
 */
function Toasts(): ReactNode {
  // Above a phone's floating tab bar and mini player, and above its floating
  // selection bar rather than over its buttons.
  const lifted = useSelectionBarFloating()
  const chrome = useFloatingChrome()
  return (
    <View
      style={[styles.toasts, { bottom: 10 + chrome + (lifted ? SELECTION_BAR_SPACE : 0) }]}
      pointerEvents="box-none"
    >
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
  barHidden: {
    opacity: 0,
  },
  barSlot: { overflow: 'hidden' },
  barInSlot: { position: 'absolute', top: 0, left: 0, right: 0 },
}))
