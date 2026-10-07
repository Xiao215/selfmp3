import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import type { StyleProp, TextStyle, ViewStyle } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { motion, space } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { usePresence } from '../motion'
import { sectionTitle } from '../surfaces'
import { IconButton } from './IconButton'
import { X } from './Icons'
import { DIALOG_RISE } from './Sheet'

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
 * Most dialogs are simply there while they are drawn. `animated` gives one the
 * computer's sheet's arrival instead (`Sheet`'s wide shape): the dim fades in
 * while the panel fades up `DIALOG_RISE` points over `motion.slow`, and it goes
 * back over `motion.base`, kept drawn until that has landed — so the caller
 * keeps it mounted and turns `open` off.
 */
export function Dialog({
  open = true,
  animated = false,
  ...rest
}: DialogProps & {
  /** Whether it is asked for. A dialog that is not `animated` is drawn only while it is. */
  open?: boolean
  /** Arrive and leave as a computer's sheet does, rather than simply being there. */
  animated?: boolean
}): ReactNode {
  const presence = usePresence(open, motion.slow, motion.base)
  const mounted = animated ? presence.mounted : open
  return mounted ? (
    <DialogLayer {...rest} open={open} progress={animated ? presence.progress : null} />
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
  /**
   * The panel: its ground, size and shape. One stylesheet style where the
   * dialog is `animated`: an `Animated.View` flattens its styles, and Unistyles
   * cannot tell two of its own apart once they are merged.
   */
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
}: DialogProps & { open: boolean; progress: Animated.Value | null }): ReactNode {
  // Only while it is asked for: Escape during an exit would answer a question
  // that has already been answered.
  useEscape(open, onEscape ?? onDismiss, { layer: true })
  // Built once per dialog: the same nodes for its whole life.
  const moving = useMemo(
    () =>
      progress === null
        ? null
        : {
            dim: { opacity: progress },
            settle: {
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
          },
    [progress],
  )

  const panel = {
    role,
    'aria-modal': true,
    accessibilityLabel: label,
    accessibilityViewIsModal: true,
    testID,
    // A browser's own event, which the types of a View do not name.
    ...(onKeyDownCapture ? ({ onKeyDownCapture } as object) : null),
  } as const

  useOverlay(
    <>
      <Animated.View style={[styles.dim, moving?.dim]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityLabel={dismissLabel}
        />
      </Animated.View>
      <View style={[styles.frame, frameStyle]} pointerEvents="box-none">
        {moving ? (
          <Animated.View style={[style, moving.settle]} {...panel}>
            {children}
          </Animated.View>
        ) : (
          <View style={style} {...panel}>
            {children}
          </View>
        )}
      </View>
    </>,
    true,
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
      <Text style={titleStyle ?? styles.title} accessibilityRole="header">
        {title}
      </Text>
      <IconButton onPress={onClose} label={closeLabel}>
        <X size={16} color={theme.colors.textSecondary} />
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
