import { useEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Animated, Easing, Pressable, ScrollView, useWindowDimensions } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { View as RNView } from 'react-native'
import { motion, radius, space } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useLayout } from '../../shell/useLayout'
import { useEscape } from '../../shell/useEscape'
import { PanelDenseContext } from './panel'
import { Sheet } from './Sheet'

/**
 * A small panel attached to the control that opened it — or a sheet, when
 * there is not enough room for one.
 *
 * One component, two shapes, and the caller does not know which it got:
 * `docs/UNIVERSAL.md` foundation 5, and its "does not port one-to-one" note
 * that a popover anchored to a button becomes a sheet below the breakpoint.
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
  children,
  width = 240,
  placement = 'auto',
  align = 'end',
  testID,
}: {
  open: boolean
  onClose: () => void
  /** The control this belongs to. Measured when it opens. */
  anchorRef: RefObject<RNView | null>
  /** Shown when it falls back to a sheet, where a panel has room for a heading. */
  title?: string
  titleTone?: 'heading' | 'label'
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
  testID?: string
}): ReactNode {
  const { wide } = useLayout()

  if (!wide) {
    return (
      <Sheet open={open} onClose={onClose} title={title} titleTone={titleTone} testID={testID}>
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
      testID={testID}
    >
      {children}
    </AnchoredPopover>
  )
}

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
  testID,
}: {
  placement: 'below' | 'above' | 'auto'
  align: 'start' | 'end'
  open: boolean
  onClose: () => void
  anchorRef: RefObject<RNView | null>
  children: ReactNode
  width: number
  testID?: string
}): ReactNode {
  const { width: screenWidth, dense } = useLayout()
  const { height: screenHeight } = useWindowDimensions()
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  // Which side it opens on needs the panel's own height, which is only known
  // once it has laid out; until then it is drawn transparent, off screen.
  const [panelHeight, setPanelHeight] = useState(0)
  const [progress] = useState(() => new Animated.Value(0))
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  useEscape(open, onClose, { layer: true })

  useEffect(() => {
    if (!open) return
    // Measured on open rather than on every render: the control does not move
    // while its panel is up, and measuring is a round trip to the shadow tree.
    anchorRef.current?.measureInWindow((x, y, w, h) => {
      setPanelHeight(0)
      setAnchor({ x, y, width: w, height: h })
    })
  }, [open, anchorRef])

  useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? motion.base : motion.fast,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) setMounted(false)
    })
  }, [open, progress])

  // Right-aligned to the anchor, then pulled back inside the screen. A control
  // near the edge is the common case for these — a sort button sits at the end
  // of its row — so the panel ends where the control does. A control on the
  // left (the player bar's tags) would push it off that side: it starts where
  // the control does instead.
  const rightAligned = anchor ? anchor.x + anchor.width - width : 0
  const startsAtControl = align === 'start' || rightAligned < space.sm
  const left = anchor
    ? startsAtControl
      ? Math.max(space.sm, Math.min(anchor.x, screenWidth - width - space.sm))
      : Math.min(rightAligned, screenWidth - width - space.sm)
    : 0
  const roomBelow = anchor ? screenHeight - (anchor.y + anchor.height) - space.sm * 2 : 0
  const roomAbove = anchor ? anchor.y - space.sm * 2 : 0
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

  useOverlay(
    <>
      {anchor ? (
        // Everywhere but the control itself. A backdrop over the control took
        // the pointer off its row, so a row's ⋯ faded out under the mouse; with
        // a hole there the row keeps its hover, and pressing the control again
        // reaches the control, which closes what it opened.
        <>
          <Pressable
            style={[styles.catcher, { top: 0, left: 0, right: 0, height: Math.max(0, anchor.y) }]}
            onPress={onClose}
            accessibilityLabel="Close"
          />
          <Pressable
            style={[
              styles.catcher,
              { top: anchor.y + anchor.height, left: 0, right: 0, bottom: 0 },
            ]}
            onPress={onClose}
          />
          <Pressable
            style={[
              styles.catcher,
              { top: anchor.y, left: 0, width: Math.max(0, anchor.x), height: anchor.height },
            ]}
            onPress={onClose}
          />
          <Pressable
            style={[
              styles.catcher,
              { top: anchor.y, left: anchor.x + anchor.width, right: 0, height: anchor.height },
            ]}
            onPress={onClose}
          />
        </>
      ) : (
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      )}
      {anchor ? (
        <Animated.View
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
                    ? anchor.y - shownHeight - space.xs
                    : anchor.y + anchor.height + space.xs,
              opacity: progress,
              // Grows out of the corner nearest its control, so the panel reads
              // as the button opening rather than a box appearing near it.
              transformOrigin: `${side === 'above' ? 'bottom' : 'top'} ${startsAtControl ? 'left' : 'right'}`,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [side === 'above' ? 4 : -4, 0],
                  }),
                },
                { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
              ],
            },
          ]}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={
              panelHeight === 0 ? undefined : { maxHeight: room - space.xs * 2 - PANEL_BORDER * 2 }
            }
          >
            <PanelDenseContext.Provider value={dense}>{children}</PanelDenseContext.Provider>
          </ScrollView>
        </Animated.View>
      ) : null}
    </>,
    mounted && anchor !== null,
  )

  return null
}

const PANEL_BORDER = 1

const styles = StyleSheet.create(theme => ({
  catcher: { position: 'absolute' },
  panel: {
    position: 'absolute',
    backgroundColor: theme.colors.surface2,
    borderWidth: PANEL_BORDER,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
    overflow: 'hidden',
    boxShadow: '0 14px 36px rgba(0, 0, 0, 0.45)',
  },
}))
