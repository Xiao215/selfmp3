import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { plural, type Song } from '@selfmp3/shared'
import { HIT_TARGET, oklchToHexAlpha, radius, space, useBulkDeleteSongs } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { showToast } from '../toast'
import { Button } from './Button'
import { floating } from '../surfaces'
import { IconButton } from './IconButton'
import { Trash, X } from './Icons'

/**
 * Removing songs from the library, from the question to the word afterwards:
 * the selection bar's and a song's ⋯ menu's are the same act, so they are the
 * same dialog doing the same things in the same order.
 *
 * On yes, the copies here go and the player lets go of the songs at once — the
 * one playing stops, and the next waits paused (`forgetSongs`) — rather than
 * after the server answers: the counts drawn from the library and the download
 * index have to lose them at the same moment, and music still playing from a
 * song you have just removed reads as the remove not having worked.
 */
export function RemoveSongs({
  songs,
  onCancel,
  onDone,
}: {
  songs: readonly Song[]
  onCancel: () => void
  /** Removed: close whatever asked. */
  onDone: () => void
}): ReactNode {
  const player = usePlayer()
  const { dropDownloads } = useDownloads()
  const bulkDelete = useBulkDeleteSongs()
  const [error, setError] = useState<string | null>(null)

  const confirm = (): void => {
    const ids = songs.map(song => song.id)
    setError(null)
    void dropDownloads(ids)
    player.forgetSongs(ids)
    bulkDelete.mutate(
      { songIds: ids },
      {
        onSuccess: result => {
          onDone()
          // The summary: what went, and what did not.
          const only = songs.length === 1 && result.removed === 1 ? songs[0] : undefined
          const parts = [
            only ? `Removed “${only.title}”` : `Removed ${plural(result.removed, 'song', 'songs')}`,
          ]
          const trouble = result.failed.length
          if (trouble > 0) parts.push(`${trouble} needed attention`)
          showToast(
            trouble > 0
              ? `${parts.join(', ')} — ${result.failed[0]?.reason ?? 'see the server log'}`
              : parts.join(', '),
            trouble > 0 ? 'warn' : 'good',
          )
        },
        onError: caught => setError(caught.message),
      },
    )
  }

  return (
    <ConfirmRemoveSongs
      songs={songs}
      pending={bulkDelete.isPending}
      error={error}
      onCancel={onCancel}
      onConfirm={confirm}
    />
  )
}

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
 * A failure is shown inside the dialog, which stays open so that trying again
 * is one press, rather than closing it and reporting underneath.
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
  // One song is named in the question, so the list under it would only repeat it.
  const only = count === 1 ? songs[0] : undefined
  const named = only ? [] : songs.slice(0, 3).map(song => song.title)
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
            {only ? `Remove “${only.title}”` : `Remove ${count} ${songWord}`} from your library?
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

          {named.length === 0 ? null : (
            <View style={styles.list}>
              {named.map((title, index) => (
                <Text key={`${title}-${index}`} style={styles.listItem} numberOfLines={1}>
                  {title}
                </Text>
              ))}
              {rest > 0 ? (
                <Text style={[styles.listItem, styles.listRest]}>
                  and {plural(rest, 'more song', 'more songs')}
                </Text>
              ) : null}
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={[styles.actions, !wide && styles.actionsCompact]}>
          <Button label="Cancel" onPress={cancel} disabled={pending} grow={!wide} />
          <Button
            label={pending ? 'Working…' : only ? 'Remove song' : `Remove ${count} ${songWord}`}
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
