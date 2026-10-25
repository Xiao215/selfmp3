import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { plural, type Song } from '@selfmp3/shared'
import {
  failureText,
  HIT_TARGET,
  space,
  type,
  useBulkDeleteSongs,
  useLibrary,
  textStyle,
  radius,
} from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useLayoutValue } from '../../shell/useLayout'
import { showToast } from '../toast'
import { Button } from './Button'
import { Dialog, DialogHead } from './Dialog'
import { lineSub, dialogPanel } from '../surfaces'
import { Trash } from './Icons'
import { ScrollView } from './Scroll'

/**
 * Deleting songs from the library, from the question to the word afterwards:
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
  const player = usePlayerCommands()
  const { dropDownloads } = useDownloads()
  const bulkDelete = useBulkDeleteSongs()
  const [error, setError] = useState<string | null>(null)
  const { data: library } = useLibrary()

  /*
   * A delete that reached the server but whose answer was lost failed here
   * while the list behind already showed the songs gone. Once every one of
   * them has left the library, it worked: say so and close.
   */
  const gone =
    error !== null &&
    library !== undefined &&
    !songs.some(song => library.songs.some(held => held.id === song.id))
  const told = useRef(false)
  useEffect(() => {
    if (!gone || told.current) return
    told.current = true
    onDone()
    const only = songs.length === 1 ? songs[0] : undefined
    showToast(
      only ? `Deleted “${only.title}”` : `Deleted ${plural(songs.length, 'song', 'songs')}`,
      'good',
    )
  }, [gone, onDone, songs])

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
            only ? `Deleted “${only.title}”` : `Deleted ${plural(result.removed, 'song', 'songs')}`,
          ]
          // Why one could not go is the server's to log, not the toast's to quote.
          const trouble = result.failed.length
          if (trouble > 0) {
            parts.push(`${plural(trouble, 'song', 'songs')} couldn’t be deleted`)
            console.warn('Songs not deleted:', result.failed)
          }
          showToast(parts.join(', '), trouble > 0 ? 'warn' : 'good')
        },
        onError: caught =>
          setError(
            failureText(songs.length === 1 ? 'Couldn’t delete it' : 'Couldn’t delete them', caught),
          ),
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
 * The confirmation for deleting a selection from the library.
 *
 * One question, one answer. Removing a song is removing it everywhere: the
 * row leaves the library on every device, whatever this device downloaded of
 * it goes with it, and the bucket lets the song's files go once nothing names
 * them (docs/SYNC.md). There is no "keep the file": the server keeps no copy
 * to keep, and a copy left on a disk somewhere is exactly how a removed song
 * comes back.
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
  const wide = useLayoutValue(layout => layout.wide)

  const count = songs.length
  const songWord = count === 1 ? 'song' : 'songs'
  // One song is named in the question, so the list under it would only repeat it.
  const only = count === 1 ? songs[0] : undefined
  const named = only ? [] : songs.slice(0, 3).map(song => song.title)
  const rest = count - named.length
  const cancel = (): void => {
    if (!pending) onCancel()
  }

  return (
    <Dialog
      onDismiss={cancel}
      dismissLabel="Cancel"
      testID="confirm-remove-songs"
      style={styles.dialog}
    >
      <DialogHead
        title={`${only ? `Delete “${only.title}”` : `Delete ${count} ${songWord}`} from your library?`}
        onClose={cancel}
        closeLabel="Cancel"
        style={styles.head}
        titleStyle={styles.title}
      />

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lede}>
          {count === 1
            ? 'It leaves your library on every device, with its tags and plays.'
            : 'They leave your library on every device, with their tags and plays.'}{' '}
          <Text style={[styles.strong, styles.strongDestructive]}>This can’t be undone.</Text>
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
          label={pending ? 'Working…' : only ? 'Delete song' : `Delete ${count} ${songWord}`}
          icon={<Trash color={theme.colors.danger} />}
          variant="danger"
          onPress={onConfirm}
          disabled={pending}
          grow={!wide}
        />
      </View>
    </Dialog>
  )
}

const styles = StyleSheet.create(theme => ({
  dialog: { ...dialogPanel(theme.colors, 'form'), maxHeight: 620 },
  head: {
    alignItems: 'flex-start',
    gap: space.md,
    paddingTop: space.lg,
    paddingRight: space.md,
    paddingBottom: space.md,
    paddingLeft: 18,
  },
  title: {
    flex: 1,
    color: theme.colors.textPrimary,
    ...textStyle('title'),
    fontWeight: '700',
    paddingTop: space.sm,
  },
  body: { paddingVertical: space.lg, paddingHorizontal: 18, gap: space.md },
  lede: lineSub(theme.colors),
  strong: { color: theme.colors.textPrimary, fontWeight: '600' },
  strongDestructive: { color: theme.colors.danger },
  list: {
    paddingVertical: space.sm,
    paddingHorizontal: space.snug,
    backgroundColor: theme.colors.surface0,
    borderRadius: radius.item,
    gap: 2,
  },
  listItem: { color: theme.colors.textSecondary, fontSize: type.small },
  listRest: { color: theme.colors.textMuted, fontStyle: 'italic' },
  error: { color: theme.colors.danger, ...textStyle('small') },
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
