import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { leading, radius, space, type } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { floating } from '../surfaces'

/**
 * A plain yes-or-no question before something that cannot be taken back.
 *
 * A browser has its own `window.confirm` for this, which a phone does not
 * have; this is that question drawn as the app's own dialog, with
 * Cancel first and the destructive choice in red. Removing songs from the
 * library has its own, richer confirmation (`ConfirmRemoveSongs`).
 *
 * It arrives and leaves the way a computer's sheet does (`Dialog`'s
 * `animated`): the ground behind it dims while the dialog fades up, and it
 * goes back the same way, staying mounted until that has landed. It used to be
 * a hard cut both ways — the only overlay in the app with no motion at all,
 * which made the one dialog that asks before something irreversible read like
 * an error box.
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
  return (
    <Dialog
      open={open}
      animated
      onDismiss={onDismiss}
      dismissLabel="Cancel"
      role="alertdialog"
      testID="confirm-dialog"
      style={styles.dialog}
    >
      <Question
        title={title}
        body={body}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        danger={danger}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Dialog>
  )
}

/** What the dialog says and the two ways out, drawn only while the dialog is. */
function Question({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel: string | null
  danger: boolean
  onConfirm: () => void
  onCancel: () => void
}): ReactNode {
  const { wide } = useLayout()
  return (
    <>
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
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  dialog: {
    width: '100%',
    maxWidth: 400,
    padding: 18,
    gap: space.md,
    backgroundColor: theme.colors.surface1,
    borderRadius: radius.sheet,
    ...floating(theme.colors),
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: type.title,
    fontWeight: '700',
    lineHeight: leading.title,
  },
  body: { color: theme.colors.textSecondary, fontSize: type.sub, lineHeight: leading.sub },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
  actionsCompact: { flexDirection: 'column-reverse' },
}))
