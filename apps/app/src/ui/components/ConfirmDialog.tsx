import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { oklchToHexAlpha, radius, space } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { Button } from './Button'

/**
 * A plain yes-or-no question before something that cannot be taken back.
 *
 * The web app asks these with the browser's own `window.confirm`, which a phone
 * does not have; this is that question drawn as the app's own dialog, with
 * Cancel first and the destructive choice in red. Removing songs from the
 * library has its own, richer confirmation (`ConfirmRemoveSongs`).
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
}): ReactNode {
  return open ? (
    <Dialog
      title={title}
      body={body}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      danger={danger}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  ) : null
}

function Dialog({
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
  const accent = useAccent()
  const { wide } = useLayout()
  useEscape(true, onCancel, { layer: true })

  useOverlay(
    <View
      style={[styles.backdrop, { backgroundColor: oklchToHexAlpha(0.1, 0.02, accent.hue, 0.62) }]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Cancel" />
      <View
        style={[styles.dialog, danger && styles.dialogDanger]}
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
      </View>
    </View>,
    true,
  )

  return null
}

const styles = StyleSheet.create(theme => ({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
    padding: 18,
    gap: space.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.lg,
  },
  dialogDanger: { borderColor: theme.colors.danger },
  title: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  body: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
  actionsCompact: { flexDirection: 'column-reverse' },
}))
