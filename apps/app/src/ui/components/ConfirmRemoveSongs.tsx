import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { Song } from '@selfmp3/shared'
import { colors, HIT_TARGET, oklchToHexAlpha, radius, space } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { IconButton } from './IconButton'
import { Trash, X } from './Icons'

/**
 * The confirmation for removing a selection from the library: the web's
 * `ConfirmRemoveSongs`, with its two faces.
 *
 * Untouched it removes rows and leaves every file where it is. Ticking the box
 * turns it red and rewrites the heading, the explanation and the button, and
 * only then can it delete anything from disk — at forty songs, "remove from my
 * list" and "destroy the files" are not degrees of the same thing and must
 * never be one mis-tap apart.
 *
 * Mounted only while it is showing, so the box always starts unticked.
 *
 * One difference from the web, because there is no toast to say it in: a
 * failure is shown inside the dialog, which stays open, rather than closing it
 * and reporting underneath.
 */
export function ConfirmRemoveSongs({
  songs,
  pending = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  songs: readonly Song[]
  pending?: boolean
  /** Why the last attempt failed, if it did. */
  error?: string | null
  onCancel: () => void
  onConfirm: (deleteFile: boolean) => void
}): ReactNode {
  const [deleteFile, setDeleteFile] = useState(false)
  const accent = useAccent()
  const { wide } = useLayout()

  const count = songs.length
  const songWord = count === 1 ? 'song' : 'songs'
  const fileWord = count === 1 ? 'file' : 'files'
  const named = songs.slice(0, 3).map(song => song.title)
  const rest = count - named.length
  const cancel = (): void => {
    if (!pending) onCancel()
  }
  useEscape(true, cancel, { layer: true })

  useOverlay(
    <View
      style={[styles.backdrop, { backgroundColor: oklchToHexAlpha(0.1, 0.02, accent.hue, 0.62) }]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessibilityLabel="Cancel" />
      <View
        style={[styles.dialog, deleteFile && styles.dialogDestructive]}
        role="dialog"
        aria-modal
        accessibilityViewIsModal
        testID="confirm-remove-songs"
      >
        <View style={styles.head}>
          <Text
            style={[styles.title, deleteFile && styles.titleDestructive]}
            accessibilityRole="header"
          >
            {deleteFile
              ? `Delete ${count} ${fileWord} from disk?`
              : `Remove ${count} ${songWord} from your library?`}
          </Text>
          <IconButton onPress={cancel} label="Cancel">
            <X size={16} color={colors.textSecondary} />
          </IconButton>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.lede}>
            {deleteFile ? (
              <>
                The {count === 1 ? 'audio file is' : `${count} audio files are`} deleted from disk
                and removed from your library.{' '}
                <Text style={[styles.strong, styles.strongDestructive]}>
                  This cannot be undone.
                </Text>
              </>
            ) : (
              <>
                The {count === 1 ? 'song' : `${count} songs`} and everything about{' '}
                {count === 1 ? 'it' : 'them'} — tags, play counts, playlist places — leave your
                library. <Text style={styles.strong}>The audio files stay where they are</Text>, so
                a rescan finds {count === 1 ? 'it' : 'them'} again.
              </>
            )}
          </Text>

          <View style={styles.list}>
            {named.map((title, index) => (
              <Text key={`${title}-${index}`} style={styles.listItem} numberOfLines={1}>
                {title}
              </Text>
            ))}
            {rest > 0 ? (
              <Text style={[styles.listItem, styles.listRest]}>
                and {rest} more {rest === 1 ? 'song' : 'songs'}
              </Text>
            ) : null}
          </View>

          <Pressable
            style={[styles.choice, deleteFile && styles.choiceOn]}
            onPress={() => setDeleteFile(value => !value)}
            disabled={pending}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: deleteFile, disabled: pending }}
          >
            <View style={styles.choiceBox}>
              <Checkbox checked={deleteFile} tone="danger" />
            </View>
            <View style={styles.choiceCopy}>
              <Text style={styles.choiceTitle}>
                Also delete the {count === 1 ? 'audio file' : `${count} audio files`} from disk
              </Text>
              <Text style={[styles.choiceHint, deleteFile && styles.choiceHintOn]}>
                {deleteFile
                  ? 'Permanent. There is no undo and nothing goes to a trash folder.'
                  : 'Off: your files are left untouched.'}
              </Text>
            </View>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={[styles.actions, !wide && styles.actionsCompact]}>
          <Button label="Cancel" onPress={cancel} disabled={pending} grow={!wide} />
          <Button
            label={
              pending
                ? 'Working…'
                : deleteFile
                  ? `Delete ${count} ${fileWord}`
                  : `Remove ${count} ${songWord}`
            }
            icon={<Trash size={15} color={deleteFile ? colors.danger : accent.onAccent} />}
            variant={deleteFile ? 'danger' : 'primary'}
            onPress={() => onConfirm(deleteFile)}
            disabled={pending}
            grow={!wide}
          />
        </View>
      </View>
    </View>,
    true,
  )

  return null
}

const styles = StyleSheet.create({
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
    maxWidth: 460,
    maxHeight: 620,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  dialogDestructive: { borderColor: colors.danger },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
    paddingTop: space.lg,
    paddingRight: space.md,
    paddingBottom: space.md,
    paddingLeft: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    paddingTop: space.sm,
  },
  titleDestructive: { color: colors.danger },
  body: { paddingVertical: space.lg, paddingHorizontal: 18, gap: space.md },
  lede: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  strong: { color: colors.textPrimary, fontWeight: '600' },
  strongDestructive: { color: colors.danger },
  list: {
    paddingVertical: space.sm,
    paddingHorizontal: 10,
    backgroundColor: colors.surface0,
    borderRadius: radius.sm,
    gap: 2,
  },
  listItem: { color: colors.textSecondary, fontSize: 12 },
  listRest: { color: colors.textMuted, fontStyle: 'italic' },
  choice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  choiceOn: { borderColor: colors.danger, backgroundColor: oklchToHexAlpha(0.3, 0.07, 22, 0.28) },
  choiceBox: { marginTop: 1 },
  choiceCopy: { flex: 1, minWidth: 0, gap: 2 },
  choiceTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '500' },
  choiceHint: { color: colors.textMuted, fontSize: 11.5, lineHeight: 17 },
  choiceHintOn: { color: colors.danger },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    paddingTop: space.md,
    paddingHorizontal: 18,
    paddingBottom: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionsCompact: { flexDirection: 'column-reverse', minHeight: HIT_TARGET },
})
