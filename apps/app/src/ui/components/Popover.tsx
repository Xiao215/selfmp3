import { useEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from 'react-native'
import type { View as RNView } from 'react-native'
import { colors, motion, radius, space } from '@selfmp3/client'
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
 * that a popover anchored to a button becomes a sheet below the breakpoint,
 * which is what the web app already does with `.popover-sheet`.
 *
 * React Native has no `position: fixed`, so above the breakpoint the anchor is
 * measured with `measureInWindow` and the panel is drawn by the shell's
 * overlay host at those coordinates. It is kept on screen: a control near the
 * right edge opens a panel that ends at the edge rather than past it.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  title,
  titleTone,
  children,
  width = 240,
  placement = 'below',
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
   * `above` for a control at the foot of the window — the player bar — where a
   * panel opening downwards would open off the screen.
   */
  placement?: 'below' | 'above'
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
  open,
  onClose,
  anchorRef,
  children,
  width,
  testID,
}: {
  placement: 'below' | 'above'
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
  // Opening upwards needs the panel's own height, which is only known once it
  // has laid out; until then it is drawn transparent where it will land.
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
  // of its row — so the panel ends where the control does.
  const left = anchor
    ? Math.max(space.sm, Math.min(anchor.x + anchor.width - width, screenWidth - width - space.sm))
    : 0

  useOverlay(
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      {anchor ? (
        <Animated.View
          testID={testID}
          onLayout={event => setPanelHeight(event.nativeEvent.layout.height)}
          style={[
            styles.panel,
            {
              width,
              left,
              // Opening upwards, the panel waits off-screen until it has
              // measured itself. Its opacity stays the animated value all the
              // while: swapping a plain 0 for an Animated value after mount
              // leaves react-native-web drawing the 0.
              top:
                placement === 'above'
                  ? panelHeight === 0
                    ? -10000
                    : anchor.y - panelHeight - space.xs
                  : anchor.y + anchor.height + space.xs,
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [placement === 'above' ? 4 : -4, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Never taller than the room on its side of the control; a long list
              — every device on the account — scrolls inside it. */}
          <ScrollView
            style={{
              maxHeight:
                placement === 'above'
                  ? anchor.y - space.sm * 2
                  : screenHeight - (anchor.y + anchor.height) - space.sm * 2,
            }}
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

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
})
