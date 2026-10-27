import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Animated, Pressable, Text } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'
import { motion, radius, space, type } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useLayoutValue, useWindowValue } from '../../shell/useLayout'
import { useEscape } from '../../shell/useEscape'
import { PanelDenseContext } from './panel'
import { contentA11y, panelA11y, Sheet, type LayerRole } from './Sheet'
import { floating } from '../surfaces'
import { CATCHER, rightClickThrough, type PopoverAnchor } from '../rightClick'
import { ease, motionMs, nativeDriver } from '../motion'
import { clamp } from '@selfmp3/shared'
import { ScrollView } from './Scroll'

/**
 * A small panel attached to the control that opened it — or a sheet, when
 * there is not enough room for one.
 *
 * One component, two shapes, and the caller does not know which it got:
 * `docs/ARCHITECTURE.md` foundation 5, and its "does not port one-to-one" note
 * that a popover anchored to a button becomes a sheet below the breakpoint.
 * With nothing to anchor to — a menu opened by holding a row, a picker opened
 * from a menu that has closed — it is a sheet at every width, which on a
 * computer is a small window in the middle of it.
 *
 * React Native has no `position: fixed`, so above the breakpoint the anchor is
 * measured with `measureInWindow` and the panel is drawn by the shell's
 * overlay host at those coordinates. It is kept on screen: a control near the
 * right edge opens a panel that ends at the edge rather than past it, and a
 * control near the foot of the window opens its panel upwards.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  title,
  titleTone,
  subtitle,
  panelTitle,
  children,
  width = 240,
  placement = 'auto',
  align = 'end',
  role = 'dialog',
  label,
  scrolls = false,
  testID,
}: {
  open: boolean
  onClose: () => void
  /**
   * The control this belongs to, measured when it opens — or the point a
   * right-click landed on (`pointAnchor`). Without one it is a sheet.
   */
  anchorRef?: RefObject<PopoverAnchor | null>
  /** Shown when it falls back to a sheet, where a panel has room for a heading. */
  title?: string
  titleTone?: 'heading' | 'label'
  /** The sheet's line under its title: what a running sleep timer has left. */
  subtitle?: string
  /** A quiet line at the top of the panel beside its control, where the sheet has its title. */
  panelTitle?: string
  children: ReactNode
  width?: number
  /**
   * `auto` opens below the control when the panel fits there and above it when
   * it does not — a song's ⋯ near the bottom of the list. `above` is for a
   * control that is always at the foot of the window: the player bar.
   */
  placement?: 'below' | 'above' | 'auto'
  /**
   * Which edge of the control the panel lines up with. `end` suits a control
   * at the end of its row; `start` one at the start of a row, such as a
   * header's ⋯ beside Play, whose panel would otherwise hang back over
   * whatever is to its left.
   */
  align?: 'start' | 'end'
  /** A menu of actions or a list of choices, rather than a dialog's own content. */
  role?: LayerRole
  /** What a screen reader calls it, where no title says: the song a menu is for. */
  label?: string
  /** The content scrolls a list of its own, under a field that stays put. */
  scrolls?: boolean
  testID?: string
}): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)

  if (!wide || !anchorRef) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={title}
        titleTone={titleTone}
        subtitle={subtitle}
        role={role}
        label={label}
        scroll={!scrolls}
        testID={testID}
      >
        {children}
      </Sheet>
    )
  }

  return (
    <AnchoredPopover
      placement={placement}
      align={align}
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      width={width}
      role={role}
      label={label ?? panelTitle ?? title}
      testID={testID}
    >
      {panelTitle ? (
        <Text style={styles.panelTitle} numberOfLines={1}>
          {panelTitle}
        </Text>
      ) : null}
      {children}
    </AnchoredPopover>
  )
}

/**
 * How far the panel slides as it grows: a few points from the side it is
 * anchored to, so it reads as coming out of its control rather than sliding in
 * from nowhere.
 */
const SLIDE = 4

/** How small the panel starts. Near enough to full size to read as a grow, not a zoom. */
const START_SCALE = 0.94

/**
 * How long an opening waits for its panel to measure itself before it gives
 * up and closes: long past a slow build's worst, short enough that the control
 * that opened it works again on the next press.
 */
const LAYOUT_WAIT_MS = 1500

interface Anchor {
  x: number
  y: number
  width: number
  height: number
}

function AnchoredPopover({
  placement,
  align,
  open,
  onClose,
  anchorRef,
  children,
  width,
  role,
  label,
  testID,
}: {
  placement: 'below' | 'above' | 'auto'
  align: 'start' | 'end'
  open: boolean
  onClose: () => void
  anchorRef: RefObject<PopoverAnchor | null>
  children: ReactNode
  width: number
  role: LayerRole
  label?: string
  testID?: string
}): ReactNode {
  const dense = useLayoutValue(layout => layout.dense)
  // The context rather than the hook, which throws outside a provider: a
  // control drawn alone in a test has no insets, and none to keep clear of.
  const safeTop = useContext(SafeAreaInsetsContext)?.top ?? 0
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  // Which side it opens on needs the panel's own height, which is only known
  // once it has laid out; until then it is drawn transparent, off screen.
  const [panelHeight, setPanelHeight] = useState(0)
  // Which opening this is. The panel is a new view each time: react-native-web
  // reports a view's layout only when its size changes, so a panel re-opened
  // at the same size — a right-click on another row while one row's menu is
  // up — never measured itself again and stayed waiting off screen.
  const [opening, setOpening] = useState(0)
  const [progress] = useState(() => new Animated.Value(0))
  const [mounted, setMounted] = useState(open)
  // The room it opens into, only while there is a panel to place: a closed
  // popover — most are — has no reason to render for a window being resized.
  const screenWidth = useLayoutValue(layout => (mounted ? layout.width : 0))
  const screenHeight = useWindowValue(window => (mounted ? window.height : 0))
  if (open && !mounted) setMounted(true)
  useEscape(open, onClose, { layer: true })
  /*
   * Whether this opening's panel has measured itself, and so is placed where it
   * can be seen. Until then it is not yet a layer: drawn off screen to be
   * measured, with no click-catchers round it, not modal and taking no
   * touches. An iPad once opened a ⋯ menu whose panel never showed while its
   * catchers covered the window: the next tap only closed a menu nobody could
   * see, and the page under it was hidden from VoiceOver (R2-m18). Now a panel
   * that does not draw leaves nothing in the way, and the grow starts from its
   * first layout rather than from the press, on a view that is there to be
   * animated.
   */
  const ready = anchor !== null && panelHeight > 0
  // And one that never measures — no layout, or a control gone before it
  // could be measured — closes, so its control opens it afresh next time
  // rather than setting an open menu open again.
  const latestClose = useRef(onClose)
  useEffect(() => {
    latestClose.current = onClose
  })
  useEffect(() => {
    if (!open || ready) return undefined
    const late = setTimeout(() => latestClose.current(), LAYOUT_WAIT_MS)
    return () => clearTimeout(late)
  }, [open, ready])

  useEffect(() => {
    if (!open) return
    // Measured on open rather than on every render: the control does not move
    // while its panel is up, and measuring is a round trip to the shadow tree.
    anchorRef.current?.measureInWindow((x, y, w, h) => {
      setPanelHeight(0)
      setOpening(count => count + 1)
      setAnchor({ x, y, width: w, height: h })
    })
  }, [open, anchorRef])

  /*
   * Its own `Animated.timing` rather than `timing` from `ui/motion`: this one
   * effect drives both directions from the same value and has to read
   * `finished`, so that a close which is interrupted by the panel being opened
   * again never unmounts the panel it has just re-opened. `motionMs` is how
   * Reduce Motion reaches it: it lands at once, and the callback still runs.
   * It leaves on `ease.in`, as everything on its way out does.
   */
  // Whether it has been open since it last closed: one mounted closed — most
  // are — has nothing to close, and started a move on mount for nothing.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (!open && !wasOpen.current) return
    // Opening, it grows once its panel is placed (`ready`).
    if (open && !ready) return
    wasOpen.current = open
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: motionMs(open ? motion.base : motion.fast),
      easing: open ? ease.out : ease.in,
      useNativeDriver: nativeDriver,
    }).start(({ finished }) => {
      if (finished && !open) setMounted(false)
    })
  }, [open, ready, progress])

  // Right-aligned to the anchor, then pulled back inside the screen. A control
  // near the edge is the common case for these — a sort button sits at the end
  // of its row — so the panel ends where the control does. A control on the
  // left (the player bar's tags) would push it off that side: it starts where
  // the control does instead. So does a menu opened at the pointer, which has
  // no width to end with and opens rightwards from the click, as menus do.
  const rightAligned = anchor ? anchor.x + anchor.width - width : 0
  const atPoint = anchor !== null && anchor.width === 0
  const startsAtControl = align === 'start' || atPoint || rightAligned < space.sm
  const left = anchor
    ? startsAtControl
      ? clamp(anchor.x, space.sm, screenWidth - width - space.sm)
      : Math.min(rightAligned, screenWidth - width - space.sm)
    : 0
  const roomBelow = anchor ? screenHeight - (anchor.y + anchor.height) - space.sm * 2 : 0
  // From under the status bar, not from the top of the window: measured from
  // the window, a control near the top had room that is not there and its
  // panel opened across the clock.
  const roomAbove = anchor ? anchor.y - safeTop - space.sm * 2 : 0
  // Below when it fits; above when it fits there instead; otherwise whichever
  // side has more room, where it scrolls — without a bar, which on a menu of
  // ten actions read as a broken window rather than a list.
  const side: 'below' | 'above' =
    placement !== 'auto'
      ? placement
      : panelHeight <= roomBelow
        ? 'below'
        : panelHeight <= roomAbove || roomAbove > roomBelow
          ? 'above'
          : 'below'
  const room = side === 'above' ? roomAbove : roomBelow
  const shownHeight = Math.min(panelHeight, room)
  // Built once per side, not per render: the panel grows out of the corner
  // nearest its control, so which way it slides is all that changes.
  const grow = useMemo(
    () => [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [side === 'above' ? SLIDE : -SLIDE, 0],
        }),
      },
      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [START_SCALE, 1] }) },
    ],
    [progress, side],
  )

  useOverlay(
    anchor ? (
      <>
        {/* Round the control once the panel is there to see (`ready`). */}
        {ready ? <Catchers anchor={anchor} onClose={onClose} /> : null}
        <Animated.View
          key={opening}
          {...panelA11y(label, onClose)}
          testID={testID}
          onLayout={event => {
            // The panel's natural height, taken once per opening before it is
            // held to the room on its side.
            const height = event.nativeEvent.layout.height
            setPanelHeight(current => (current === 0 ? height : current))
          }}
          style={[
            styles.panel,
            {
              width,
              left,
              // Waits off screen until it has measured itself. Its opacity stays
              // the animated value all the while: swapping a plain 0 for an
              // Animated value after mount leaves react-native-web drawing the 0.
              top:
                panelHeight === 0
                  ? -10000
                  : side === 'above'
                    ? // Never past the top of the page, however short the room.
                      Math.max(safeTop + space.xs, anchor.y - shownHeight - space.xs)
                    : anchor.y + anchor.height + space.xs,
              opacity: progress,
              // Grows out of the corner nearest its control, so the panel reads
              // as the button opening rather than a box appearing near it.
              transformOrigin: `${side === 'above' ? 'bottom' : 'top'} ${startsAtControl ? 'left' : 'right'}`,
              transform: grow,
            },
          ]}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={panelHeight === 0 ? undefined : { maxHeight: room - space.xs * 2 }}
            {...contentA11y(role)}
          >
            <PanelDenseContext.Provider value={dense}>{children}</PanelDenseContext.Provider>
          </ScrollView>
        </Animated.View>
      </>
    ) : null,
    mounted && anchor !== null,
    open && ready,
  )

  return null
}

/** The click-catchers round an open panel's control. */
function Catchers({ anchor, onClose }: { anchor: Anchor; onClose: () => void }): ReactNode {
  return (
    <>
      {/*
        Everywhere but the control itself. A backdrop over the control would
        take the pointer off its row, so a row's ⋯ would fade out under the
        mouse; with a hole there the row keeps its hover, and pressing the
        control again reaches the control, which closes what it opened. A
        right-click outside closes it too, and is then a right-click on what
        is under it — another row's menu opens at once — rather than the
        browser's menu.
      */}
      {/* One of them is a Close button to a screen reader, the rest are not
        there to it; none is a Tab stop, the keyboard has Escape. */}
      <Pressable
        style={[styles.catcher, { top: 0, left: 0, right: 0, height: Math.max(0, anchor.y) }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        tabIndex={-1}
        {...rightClickThrough(onClose)}
        {...CATCHER}
      />
      <Pressable
        style={[styles.catcher, { top: anchor.y + anchor.height, left: 0, right: 0, bottom: 0 }]}
        onPress={onClose}
        {...UNSEEN}
        {...rightClickThrough(onClose)}
        {...CATCHER}
      />
      <Pressable
        style={[
          styles.catcher,
          { top: anchor.y, left: 0, width: Math.max(0, anchor.x), height: anchor.height },
        ]}
        onPress={onClose}
        {...UNSEEN}
        {...rightClickThrough(onClose)}
        {...CATCHER}
      />
      <Pressable
        style={[
          styles.catcher,
          { top: anchor.y, left: anchor.x + anchor.width, right: 0, height: anchor.height },
        ]}
        onPress={onClose}
        {...UNSEEN}
        {...rightClickThrough(onClose)}
        {...CATCHER}
      />
    </>
  )
}

/** A click-catcher besides the first: neither a Tab stop nor anything to a screen reader. */
const UNSEEN = { tabIndex: -1, 'aria-hidden': true } as const

const styles = StyleSheet.create(theme => ({
  panelTitle: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    paddingHorizontal: space.snug,
    paddingTop: space.sm,
    paddingBottom: space.tight,
  },
  catcher: { position: 'absolute' },
  // A control-toned panel with no edge: it floats, so its shadow and its tone
  // tell it from the page (`S2`, "Depth").
  panel: {
    position: 'absolute',
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.card,
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
    overflow: 'hidden',
    ...floating(theme.colors),
  },
}))
