import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { motion, oklchToHexAlpha, radius, space } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { usePresence } from '../motion'
import { Button } from './Button'
import { DIALOG_RISE } from './Sheet'
import { floating } from '../surfaces'

/**
 * A plain yes-or-no question before something that cannot be taken back.
 *
 * A browser has its own `window.confirm` for this, which a phone does not
 * have; this is that question drawn as the app's own dialog, with
 * Cancel first and the destructive choice in red. Removing songs from the
 * library has its own, richer confirmation (`ConfirmRemoveSongs`).
 *
 * It arrives and leaves the way a computer's sheet does (`Sheet`'s wide shape):
 * the ground behind it dims while the dialog fades up `DIALOG_RISE` points, over
 * `motion.slow` on `ease.out`, and it goes back over `motion.base` on `ease.in`,
 * staying mounted until that has landed. It used to be a hard cut both ways —
 * the only overlay in the app with no motion at all, which made the one dialog
 * that asks before something irreversible read like an error box.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
  onDismiss = onCancel,
}: {
  open: boolean
  title: string
  body?: string
  confirmLabel: string
  /** Null for a notice with only one way out. */
  cancelLabel?: string | null
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  /**
   * Closing without choosing — the backdrop, Escape. Cancel, unless the second
   * button is a choice of its own (the artist nudge's "Make the tag anyway").
   */
  onDismiss?: () => void
}): ReactNode {
  const { mounted, progress } = usePresence(open, motion.slow, motion.base)
  return mounted ? (
    <Dialog
      open={open}
      progress={progress}
      title={title}
      body={body}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      danger={danger}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onDismiss={onDismiss}
    />
  ) : null
}

function Dialog({
  open,
  progress,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
  onDismiss,
}: {
  open: boolean
  progress: Animated.Value
  title: string
  body?: string
  confirmLabel: string
  cancelLabel: string | null
  danger: boolean
  onConfirm: () => void
  onCancel: () => void
  onDismiss: () => void
}): ReactNode {
  const accent = useAccent()
  const { wide } = useLayout()
  // Only while it is still up: Escape during the exit would answer a question
  // that has already been answered.
  useEscape(open, onDismiss, { layer: true })
  // Built once: the same rise for the life of the dialog.
  const settle = useMemo(
    () => ({
      opacity: progress,
      transform: [
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [DIALOG_RISE, 0] }) },
      ],
    }),
    [progress],
  )
  const dim = useMemo(() => ({ opacity: progress }), [progress])

  useOverlay(
    <>
      {/*
        The dim is its own layer beside the frame the dialog is centred in, not
        the frame itself: a fading parent would take the dialog's own opacity
        with it, and the two do not fade over the same length. `Sheet` splits
        them the same way.
      */}
      <Animated.View
        style={[
          styles.backdrop,
          { backgroundColor: oklchToHexAlpha(0.1, 0.02, accent.hue, 0.62) },
          dim,
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityLabel="Cancel"
        />
      </Animated.View>
      <View style={styles.frame} pointerEvents="box-none">
        <Animated.View
          style={[styles.dialog, settle]}
          role="alertdialog"
          aria-modal
          accessibilityViewIsModal
          testID="confirm-dialog"
        >
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {body ? <Text style={styles.body}>{body}</Text> : null}
          <View style={[styles.actions, !wide && styles.actionsCompact]}>
            {cancelLabel === null ? null : (
              <Button label={cancelLabel} onPress={onCancel} grow={!wide} />
            )}
            <Button
              label={confirmLabel}
              variant={danger ? 'danger' : 'primary'}
              onPress={onConfirm}
              grow={!wide}
            />
          </View>
        </Animated.View>
      </View>
    </>,
    true,
  )

  return null
}

/** Everything that fills the window: the frame the dialog is centred in, and the dim. */
const FILL = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const

const styles = StyleSheet.create(theme => ({
  frame: {
    ...FILL,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  backdrop: FILL,
  dialog: {
    width: '100%',
    maxWidth: 400,
    padding: 18,
    gap: space.md,
    backgroundColor: theme.colors.surface1,
    borderRadius: radius.sheet,
    ...floating(theme.colors),
  },
  title: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  body: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
  actionsCompact: { flexDirection: 'column-reverse' },
}))
