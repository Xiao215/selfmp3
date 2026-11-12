import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import type { StyleProp, TextStyle, ViewStyle } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { motion, space, iconSize } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { usePresence } from '../motion'
import { sectionTitle } from '../surfaces'
import { IconButton } from './IconButton'
import { X } from './Icons'
import { BACKDROP_SETTLE_MS, DIALOG_RISE } from './Sheet'

/**
 * A window in the middle of the app, over a dimmed page: the shell every
 * dialog shares — a yes-or-no question, removing songs, fixing a song's
 * metadata, the command palette.
 *
 * Drawn by the shell's overlay host, not in a `Modal` (`shell/Overlay.tsx`).
 * The dim is a layer of its own beside the frame the panel is placed in, not
 * the frame itself, so a dim that fades never takes the panel's own opacity
 * with it. A press on the dim and Escape both dismiss, Escape as the top layer
 * only (`useEscape`). To a screen reader the panel is a modal dialog.
 *
 * Every dialog arrives and leaves as a computer's sheet does (`Sheet`'s wide
 * shape): the dim fades in while the panel fades up `DIALOG_RISE` points over
 * `motion.slow`, and goes back over `motion.base`. One mounted already open
 * moves in too, rather than simply being there (2026-11-11: a palette or a
 * question that appeared in one frame read as a cut). A caller that keeps it
 * mounted and turns `open` off sees it leave the same way; one that unmounts
 * it takes it away at once.
 */
export function Dialog({
  open = true,
  ...rest
}: DialogProps & {
  /** Whether it is asked for: kept drawn until its exit has landed. */
  open?: boolean
}): ReactNode {
  const presence = usePresence(open, motion.slow, motion.base, { appear: true })
  return presence.mounted ? (
    <DialogLayer {...rest} open={open} progress={presence.progress} />
  ) : null
}

interface DialogProps {
  /** A press on the dim, and Escape: closing without choosing. */
  onDismiss: () => void
  /** Escape, where it means something other than `onDismiss`: stepping back inside the dialog. */
  onEscape?: () => void
  /** What the dim says it does, to a screen reader: "Close", "Cancel". */
  dismissLabel?: string
  /** `alertdialog` for a question that has to be answered. */
  role?: 'dialog' | 'alertdialog'
  /** What a screen reader calls the dialog. */
  label?: string
  testID?: string
  /** The frame the panel is placed in: centred, with room all round, unless this says otherwise. */
  frameStyle?: StyleProp<ViewStyle>
  /** The panel: its ground, size and shape. */
  style: StyleProp<ViewStyle>
  /** Keys pressed anywhere in the panel, before what has the focus hears them (a browser's). */
  onKeyDownCapture?: (event: never) => void
  children: ReactNode
}

function DialogLayer({
  open,
  progress,
  onDismiss,
  onEscape,
  dismissLabel = 'Close',
  role = 'dialog',
  label,
  testID,
  frameStyle,
  style,
  onKeyDownCapture,
  children,
}: DialogProps & { open: boolean; progress: Animated.Value }): ReactNode {
  // Only while it is asked for: Escape during an exit would answer a question
  // that has already been answered.
  useEscape(open, onEscape ?? onDismiss, { layer: true })
  const [shownAt] = useState(() => Date.now())
  // Built once per dialog: the same nodes for its whole life.
  const moving = useMemo(
    () => ({
      dim: { opacity: progress },
      // On a plain layer of its own around the frame, so the panel's and the
      // frame's own styles never pass through an Animated.View: it flattens
      // them, and Unistyles cannot tell two of its own apart once merged.
      settle: [
        FILL,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [DIALOG_RISE, 0],
              }),
            },
          ],
        },
      ],
    }),
    [progress],
  )

  const panel = {
    role,
    'aria-modal': true,
    accessibilityLabel: label,
    accessibilityViewIsModal: true,
    onAccessibilityEscape: onEscape ?? onDismiss,
    // Somewhere for focus to go when nothing in it takes it, never a Tab stop.
    tabIndex: -1,
    testID,
    // A browser's own event, which the types of a View do not name.
    ...(onKeyDownCapture ? ({ onKeyDownCapture } as object) : null),
  } as const

  useOverlay(
    <>
      <Animated.View style={[styles.dim, moving.dim]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            // Not the second click of the double click that opened it (`BACKDROP_SETTLE_MS`).
            if (Date.now() - shownAt >= BACKDROP_SETTLE_MS) onDismiss()
          }}
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          tabIndex={-1}
        />
      </Animated.View>
      <Animated.View style={moving.settle} pointerEvents="box-none">
        <View style={[styles.frame, frameStyle]} pointerEvents="box-none">
          <View style={style} {...panel}>
            {children}
          </View>
        </View>
      </Animated.View>
    </>,
    true,
    open,
  )

  return null
}

/**
 * A dialog's head: its title, and the × that closes it. The room around it is
 * the caller's, as each dialog's own padding is.
 */
export function DialogHead({
  title,
  onClose,
  closeLabel = 'Close',
  style,
  titleStyle,
}: {
  title: string
  onClose: () => void
  closeLabel?: string
  style?: StyleProp<ViewStyle>
  /** The title's own type, where a section title's is not it. */
  titleStyle?: StyleProp<TextStyle>
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <View style={[styles.head, style]}>
      <Text style={titleStyle ?? styles.title} accessibilityRole="header" aria-level={2}>
        {title}
      </Text>
      <IconButton onPress={onClose} label={closeLabel}>
        <X size={iconSize.item} color={theme.colors.textSecondary} />
      </IconButton>
    </View>
  )
}

/** Everything that fills the window: the dim, and the frame the panel is placed in. */
const FILL = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const

const styles = StyleSheet.create(theme => ({
  dim: { ...FILL, backgroundColor: theme.colors.backdrop },
  frame: { ...FILL, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: sectionTitle(theme.colors),
}))
