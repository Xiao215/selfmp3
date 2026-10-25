import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQueryClient } from '@tanstack/react-query'
import { plural, type AskAnswer, type Library } from '@selfmp3/shared'
import { clientApi, failureText, queryKeys, radius, space, type, useLibrary } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Checkbox, CheckRow } from '../../ui/components/Checkbox'
import { ART } from '../../ui/components/ToastHost'
import { showPendingToast, showUndoToast } from '../../ui/toast'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { FOLLOWS_LABEL, isLive } from '../playlists/playlists.model'
import { StatusLine } from '../../ui/components/StatusLine'
import { AnswerActions, AnswerHead, AnswerLine, AnswerNote, CLOSED } from './AnswerParts'
import { textColumn } from '../../ui/surfaces'

/**
 * Ask's answer to "delete…" or "rename…" playlists (docs/features/ai.md): a
 * proposal, like every answer. The playlists it found are listed by their real
 * names, each ticked; nothing changes until the button is pressed, which is
 * the confirmation, and the message after it has Undo. A delete is not sent
 * until that Undo has gone, so an Undo has nothing to rebuild.
 */
export function PlaylistsAnswer({
  answer,
  onDone,
}: {
  answer: Extract<AskAnswer, { kind: 'playlists' }>
  /** Done with: what was done, or that nothing changed. */
  onDone: (outcome?: string) => void
}): ReactNode {
  const { data: library } = useLibrary()
  const queryClient = useQueryClient()
  const found = answer.names.flatMap(
    name => library?.playlists.filter(playlist => playlist.name === name) ?? [],
  )
  const [ticked, setTicked] = useState<ReadonlySet<number>>(
    () => new Set(found.map(playlist => playlist.id)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const renaming = answer.op === 'rename'
  const chosen = found.filter(playlist => ticked.has(playlist.id))
  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: queryKeys.library })

  if (found.length === 0) {
    return <AnswerLine>Those playlists are gone already.</AnswerLine>
  }

  const remove = (): void => {
    if (chosen.length === 0 || busy) return
    const gone = new Set(chosen.map(playlist => playlist.id))
    const [only] = chosen
    const deleted =
      chosen.length === 1 && only
        ? `Deleted “${only.name}”`
        : `Deleted ${plural(chosen.length, 'playlist', 'playlists')}`
    // Out of the library drawn here at once; nothing is sent until the Undo
    // has gone, and asking for the library again brings them back after an
    // Undo or a delete that failed.
    queryClient.setQueryData<Library>(
      queryKeys.library,
      current =>
        current && {
          ...current,
          playlists: current.playlists.filter(playlist => !gone.has(playlist.id)),
        },
      { updatedAt: queryClient.getQueryState(queryKeys.library)?.dataUpdatedAt },
    )
    showPendingToast(
      {
        over: chosen.length === 1 ? 'Deleted the playlist' : 'Deleted',
        say:
          chosen.length === 1 && only ? only.name : plural(chosen.length, 'playlist', 'playlists'),
      },
      async () => {
        try {
          for (const id of gone) await clientApi().deletePlaylist(id)
        } finally {
          await refresh()
        }
      },
      {
        tone: 'good',
        failed: 'Couldn’t delete them',
        undone: () => void refresh(),
        art: only && chosen.length === 1 ? <PlaylistCover playlist={only} size={ART} /> : undefined,
      },
    )
    onDone(deleted)
  }

  const rename = async (): Promise<void> => {
    const playlist = found[0]
    const to = answer.newName
    if (!playlist || !to || busy) return
    setBusy(true)
    setError(null)
    try {
      await clientApi().updatePlaylist(playlist.id, { name: to })
      await refresh()
      showUndoToast(
        { over: 'Renamed the playlist', say: to },
        () => clientApi().updatePlaylist(playlist.id, { name: playlist.name }).then(refresh),
        { tone: 'good', failed: 'Couldn’t undo that' },
      )
      onDone(`Renamed “${playlist.name}” to “${to}”`)
    } catch (caught) {
      setError(failureText('Couldn’t rename it', caught))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: number): void =>
    setTicked(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <View style={styles.body} testID="playlists-answer">
      <AnswerHead>
        {renaming
          ? 'Rename this playlist?'
          : found.length === 1
            ? 'Delete this playlist?'
            : 'Delete these playlists?'}
      </AnswerHead>
      {(renaming ? found.slice(0, 1) : found).map(playlist => {
        const on = ticked.has(playlist.id)
        const meta = [
          plural(playlist.songCount, 'song', 'songs'),
          isLive(playlist) ? FOLLOWS_LABEL : null,
        ]
          .filter(Boolean)
          .join(' · ')
        const row = (
          <>
            <PlaylistCover playlist={playlist} size={40} />
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1}>
                {renaming ? (
                  <>
                    <Text style={styles.old}>{playlist.name}</Text>
                    <Text style={styles.arrow}>{'  →  '}</Text>
                    {answer.newName}
                  </>
                ) : (
                  playlist.name
                )}
              </Text>
              <Text style={styles.meta}>{meta}</Text>
            </View>
          </>
        )
        return renaming ? (
          <View key={playlist.id} style={styles.row}>
            {row}
          </View>
        ) : (
          <CheckRow
            key={playlist.id}
            checked={on}
            label={playlist.name}
            onPress={() => toggle(playlist.id)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            {row}
            <Checkbox checked={on} />
          </CheckRow>
        )
      })}
      {answer.unknown.length > 0 ? (
        <AnswerNote>
          No playlist here is called {answer.unknown.map(name => `“${name}”`).join(' or ')}.
        </AnswerNote>
      ) : null}
      {error ? <StatusLine>{error}</StatusLine> : null}
      <AnswerActions>
        <Button label="Cancel" onPress={() => onDone(CLOSED)} />
        {renaming ? (
          <Button
            label="Rename"
            variant="primary"
            busy={busy}
            onPress={() => void rename()}
            testID="playlists-answer-rename"
          />
        ) : (
          <Button
            label={
              chosen.length === 0
                ? 'Delete'
                : `Delete ${plural(chosen.length, 'playlist', 'playlists')}`
            }
            variant="danger"
            disabled={chosen.length === 0}
            busy={busy}
            onPress={remove}
            testID="playlists-answer-delete"
          />
        )}
      </AnswerActions>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.tight,
    paddingHorizontal: space.xs,
    borderRadius: radius.coverSm,
  },
  pressed: { opacity: 0.7 },
  text: textColumn,
  name: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '500' },
  old: { color: theme.colors.textMuted, fontWeight: '400' },
  arrow: { color: theme.colors.textMuted },
  meta: { color: theme.colors.textMuted, fontSize: type.small },
}))
