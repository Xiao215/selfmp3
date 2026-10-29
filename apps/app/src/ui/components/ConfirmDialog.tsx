import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space, textStyle } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { holdPresses } from '../../shell/Overlay'
import { lineSub, dialogPanel, textColumn } from '../surfaces'

/**
 * A plain yes-or-no question before something that cannot be taken back.
 *
 * A browser has its own `window.confirm` for this, which a phone does not
 * have; this is that question drawn as the app's own dialog: the thing it is
 * about pictured (a song's cover, a playlist's mosaic), a short question
 * ("Delete this song?") with its name under it, one plain line, then Cancel
 * and the destructive choice in red. No ×: Cancel, Escape and a press
 * outside are the ways out. Deleting songs (`ConfirmRemoveSongs`) asks with
 * it too.
 *
 * It arrives and leaves the way a computer's sheet does (`Dialog`'s
 * `animated`): the ground behind it dims while the dialog fades up, and it
 * goes back the same way, staying mounted until that has landed, so the one
 * dialog that asks before something irreversible does not read like an error
 * box.
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
  picture,
  name,
  busy = false,
  error = null,
  testID = 'confirm-dialog',
}: {
  open: boolean
  /** The question, short: "Delete this song?". */
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
  /** What it is about, beside the question: a cover, a mosaic, a tag's dot. */
  picture?: ReactNode
  /** Its name, under the question. */
  name?: string
  /** Working on the answer: both buttons wait, and the confirm one spins. */
  busy?: boolean
  /** Why the last answer did not go through; the dialog stays for another try. */
  error?: string | null
  testID?: string
}): ReactNode {
  return (
    <Dialog
      open={open}
      animated
      onDismiss={onDismiss}
      dismissLabel="Cancel"
      role="alertdialog"
      testID={testID}
      style={styles.dialog}
    >
      <Question
        title={title}
        body={body}
        picture={picture}
        name={name}
        busy={busy}
        error={error}
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
  picture,
  name,
  busy,
  error,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  body?: string
  picture?: ReactNode
  name?: string
  busy: boolean
  error: string | null
  confirmLabel: string
  cancelLabel: string | null
  danger: boolean
  onConfirm: () => void
  onCancel: () => void
}): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  return (
    <>
      <View style={styles.lead}>
        {picture}
        <View style={styles.question}>
          <Text style={styles.title} accessibilityRole="header" aria-level={2}>
            {title}
          </Text>
          {name ? (
            <Text style={styles.name} numberOfLines={2}>
              {name}
            </Text>
          ) : null}
        </View>
      </View>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={[styles.actions, !wide && styles.actionsCompact]}>
        {cancelLabel === null ? null : (
          <Button label={cancelLabel} onPress={onCancel} disabled={busy} grow={!wide} />
        )}
        <Button
          label={confirmLabel}
          variant={danger ? 'danger' : 'primary'}
          onPress={() => {
            // What is confirmed often takes the page with it, and the second
            // press of a double tap landed on the next one (`holdPresses`).
            holdPresses()
            onConfirm()
          }}
          busy={busy}
          grow={!wide}
        />
      </View>
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  dialog: { ...dialogPanel(theme.colors, 'confirm'), padding: 18, gap: space.md },
  lead: { flexDirection: 'row', alignItems: 'center', gap: space.roomy },
  question: textColumn,
  title: { color: theme.colors.textPrimary, fontWeight: '700', ...textStyle('title') },
  name: { color: theme.colors.textSecondary, ...textStyle('sub') },
  body: lineSub(theme.colors),
  error: { color: theme.colors.danger, ...textStyle('small') },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
  actionsCompact: { flexDirection: 'column-reverse' },
}))
