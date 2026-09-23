import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { HIT_TARGET, oklchToHexAlpha, radius, space } from '@selfmp3/client'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { Button } from './Button'
import { floating } from '../surfaces'
import { IconButton } from './IconButton'
import { Trash, X } from './Icons'

/**
 * The confirmation for removing a selection from the library.
 *
 * One question, one answer. Removing a song is removing it everywhere: the
 * row leaves the library on every device, whatever this device downloaded of
 * it goes with it, and the bucket lets the song's files go once nothing names
 * them (docs/SYNC.md). There is no "keep the file": the server keeps no copy
 * to keep, and a copy left on a disk somewhere is exactly how removed songs
 * used to come back.
 *
 * Because there is no toast to say it in, a failure is shown inside the
 * dialog, which stays open, rather than closing it and reporting underneath.
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
  onConfirm: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { wide } = useLayout()

  const count = songs.length
  const songWord = count === 1 ? 'song' : 'songs'
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
        style={styles.dialog}
        role="dialog"
        aria-modal
        accessibilityViewIsModal
        testID="confirm-remove-songs"
      >
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            Remove {count} {songWord} from your library?
          </Text>
          <IconButton onPress={cancel} label="Cancel">
            <X size={16} color={theme.colors.textSecondary} />
          </IconButton>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.lede}>
            The {count === 1 ? 'song' : `${count} songs`} and everything about{' '}
            {count === 1 ? 'it' : 'them'} — tags, play counts, playlist places — leave your library
            on every device, and{' '}
            <Text style={styles.strong}>anything downloaded here is deleted from this device</Text>.{' '}
            <Text style={[styles.strong, styles.strongDestructive]}>This cannot be undone.</Text>
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

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={[styles.actions, !wide && styles.actionsCompact]}>
          <Button label="Cancel" onPress={cancel} disabled={pending} grow={!wide} />
          <Button
            label={pending ? 'Working…' : `Remove ${count} ${songWord}`}
            icon={<Trash size={15} color={theme.colors.danger} />}
            variant="danger"
            onPress={onConfirm}
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
    maxWidth: 460,
    maxHeight: 620,
    backgroundColor: theme.colors.surface1,
    borderRadius: radius.sheet,
    overflow: 'hidden',
    ...floating(theme.colors),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
    paddingTop: space.lg,
    paddingRight: space.md,
    paddingBottom: space.md,
    paddingLeft: 18,
  },
  title: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    paddingTop: space.sm,
  },
  body: { paddingVertical: space.lg, paddingHorizontal: 18, gap: space.md },
  lede: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 },
  strong: { color: theme.colors.textPrimary, fontWeight: '600' },
  strongDestructive: { color: theme.colors.danger },
  list: {
    paddingVertical: space.sm,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.surface0,
    borderRadius: 12,
    gap: 2,
  },
  listItem: { color: theme.colors.textSecondary, fontSize: 12 },
  listRest: { color: theme.colors.textMuted, fontStyle: 'italic' },
  error: { color: theme.colors.danger, fontSize: 12, lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    paddingTop: space.md,
    paddingHorizontal: 18,
    paddingBottom: space.lg,
  },
  actionsCompact: { flexDirection: 'column-reverse', minHeight: HIT_TARGET },
}))
